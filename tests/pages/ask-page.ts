import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Endpoint the unauthenticated chat posts to. Waiting on this gives a hard
 * network-level signal, which is what lets a failure say "backend returned 502"
 * instead of the useless "timed out waiting for element".
 */
export const ASK_ENDPOINT_RE = /\/api\/agent\/ask-unauthenticated/;
export const SUGGESTIONS_PATH = '/api/agent/suggestions-unauthenticated';

/** Hard ceiling for one agent reply. Observed replies land in 2-8s; 30s is ~4x
 *  the worst observed case, which absorbs cold starts without hiding a hang. */
export const AGENT_REPLY_TIMEOUT = 30_000;

/**
 * How long the suggested-topic pills get to appear before we call them absent.
 *
 * The page fetches /suggestions-unauthenticated during first paint (it has
 * already returned 200 by the time the greeting bubble renders), so pills that
 * are going to render have rendered well inside this. 12s is roughly 10x the
 * observed API round-trip - long enough that a cold cache cannot be mistaken for
 * the defect, short enough that the two known-failing tests do not dominate the
 * suite runtime.
 */
export const PILL_RENDER_TIMEOUT = 12_000;

/** One row of GET /api/agent/suggestions-unauthenticated. */
export interface Suggestion {
  id: string;
  /** Short label shown on the pill, e.g. "Best way to earn ASK". */
  title: string;
  /** Full question the pill is supposed to submit, e.g. "How can i earn ASK?". */
  prompt: string;
  for_authenticated: boolean;
  order: number;
  enabled: boolean;
}

/** One served title, and whether the page rendered a real control for it. */
export interface PillProbe {
  title: string;
  /** A non-transcript, non-vendor interactive element whose whole label is this title. */
  found: boolean;
  visible: boolean;
  tag: string | null;
  testid: string | null;
}

export interface PillReport {
  pills: PillProbe[];
  /** Titles present anywhere in visible page text - including inside chat bubbles. */
  titlesInBodyText: string[];
  /** Titles present anywhere in the served markup. Distinguishes "hidden" from "never rendered". */
  titlesInRawHtml: string[];
  /** Every visible interactive label on the page, for the failure message. */
  interactiveNames: string[];
  /** Wall-clock ms spent waiting for the pills. */
  waitedMs: number;
}

/** Escapes a served title so it can be anchored in a locator regex. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface AgentReply {
  /** Text of the newly-arrived agent message. */
  text: string;
  /** Wall-clock ms from submit to the message being present in the DOM. */
  elapsedMs: number;
  /** HTTP status of the /ask POST that produced it. */
  status: number;
}

/**
 * Page object for the Permission Agent chat at ask.permission.ai.
 *
 * Locator policy, in priority order:
 *   1. data-testid   - the app ships these on every control we need
 *   2. ARIA role/text - used for the cookie dialog, which is third-party
 *   3. CSS class      - used ONLY for agent message bubbles, because the app
 *                       ships no test hook on them at all. Flagged in
 *                       artifacts/ux-review.md as the one testability gap.
 */
export class AskPage {
  readonly page: Page;

  readonly input: Locator;
  readonly sendButton: Locator;
  readonly agentTitle: Locator;
  readonly agentDescription: Locator;
  readonly loginButton: Locator;
  readonly signUpButton: Locator;
  readonly shiftEnterHint: Locator;

  /**
   * Agent message bubbles - exactly one node per agent message.
   *
   * The app ships no test hook on chat messages, so this is the one class-based
   * locator in the suite. Which class matters a lot; measured across a message
   * lifecycle with a multi-paragraph reply
   * (recon/explore-bubbles.spec.ts -> artifacts/recon/60-locator-comparison.json):
   *
   *   locator                              before | user sent | after reply
   *   p.leading-relaxed                       1   |     1     |    2 or 3  <- WRONG
   *   div.text-md.leading-relaxed             1   |     2     |     3      <- WRONG
   *   div.rounded-lg[class*="fit-content"]    1   |     1     |     2      <- correct
   *
   * p.leading-relaxed counts PARAGRAPHS, not messages, so its final value tracks
   * how many paragraphs the agent happened to write: 2 for a one-paragraph reply,
   * 3 for a two-paragraph one. That variance is exactly why it is unusable - the
   * expected count depends on the model's prose. It is what broke the first version
   * of this suite.
   *
   * div.text-md.leading-relaxed wraps the user's own bubble too, so it increments
   * the instant the user hits send - before the agent has answered anything. That
   * one is worse: it yields a false-positive pass.
   *
   * Only the w-[fit-content] bubble is one-per-agent-message and blind to the
   * user's echo.
   *
   * Both wrong answers were found by running the suite, not by reading the DOM.
   */
  readonly agentMessages: Locator;

  constructor(page: Page) {
    this.page = page;
    this.input = page.getByTestId('agent-chat-input');
    this.sendButton = page.getByTestId('agent-chat-input-send-button');
    this.agentTitle = page.getByTestId('ai-page-title');
    this.agentDescription = page.getByTestId('ai-page-description');
    this.loginButton = page.getByTestId('log-in-button');
    this.signUpButton = page.getByTestId('sign-up-button');
    this.shiftEnterHint = page.getByText(/Press\s*Shift\s*\+\s*Enter for new line/i);
    this.agentMessages = page.locator('div.rounded-lg[class*="fit-content"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
    await this.dismissCookieBanner();
    /* The greeting is server-generated, so its arrival is the real "app is
     * ready" signal - more meaningful than networkidle on a page that holds
     * open analytics sockets. */
    await expect(this.agentMessages.first()).toBeVisible({ timeout: 20_000 });
    await expect(this.input).toBeEnabled();
  }

  /**
   * OneTrust renders a fixed-position consent dialog whose "Accept All" button
   * sits at y=707 while the chat input sits at y=672 on a 1440x900 viewport -
   * it physically overlaps the composer and intercepts pointer events. Every
   * test therefore has to clear it first.
   *
   * "Reject All" rather than "Accept All" on purpose: it dismisses the dialog
   * identically but does not opt an automated browser into marketing pixels,
   * so the suite does not pollute production analytics with bot traffic.
   */
  async dismissCookieBanner(): Promise<void> {
    const reject = this.page.locator('#onetrust-reject-all-handler');
    try {
      await reject.waitFor({ state: 'visible', timeout: 12_000 });
      await reject.click();
      await expect(reject).toBeHidden({ timeout: 8_000 });
    } catch {
      /* Consent is persisted per storage state; on a context where it is
       * already dismissed the banner never appears. Absence is fine - what is
       * NOT fine is it being present and blocking, which the overlap assertion
       * in the caller would surface. */
    }
  }

  async agentMessageCount(): Promise<number> {
    return this.agentMessages.count();
  }

  /**
   * Prose of a single agent bubble, timestamp excluded.
   *
   * Reading innerText off the bubble itself would append the rendered clock -
   * "...checking your ASK balance?03:22 AM" - which would then be fed to the
   * relevance grader as if the agent had said it. Joining the bubble's own
   * paragraphs keeps multi-paragraph replies intact and leaves the timestamp out.
   */
  async agentMessageText(index = -1): Promise<string> {
    const bubble = index < 0 ? this.agentMessages.last() : this.agentMessages.nth(index);
    const paragraphs = await bubble.locator('p.leading-relaxed').allInnerTexts();
    return paragraphs.join('\n\n').trim();
  }

  /** Text of the most recent agent message. */
  async lastAgentMessage(): Promise<string> {
    return this.agentMessageText(-1);
  }

  /**
   * Type a question and submit it, then wait for the agent's reply.
   *
   * The strategy deliberately layers three independent signals instead of
   * sleeping or polling for text:
   *
   *   1. NETWORK  - wait for the POST /api/agent/ask-unauthenticated response.
   *                 Gives an HTTP status, so an upstream 5xx is reported as a
   *                 backend failure rather than a mystery element timeout.
   *   2. DOM      - wait for the agent-message count to increment. This is the
   *                 user-visible outcome; a 200 that renders nothing is a real
   *                 bug and this catches it.
   *   3. IDLE     - wait for the composer to be re-enabled, which is how this
   *                 app signals "request settled" (see inputLockedDuringRequest).
   *
   * No text stabilisation loop: recon confirmed the reply arrives as one atomic
   * JSON payload and the bubble is rendered fully-formed, not token-streamed.
   * If the app later ships incremental streaming, a settle check would be
   * required here - noted in artifacts/assertions.md.
   */
  async askAndWaitForReply(
    question: string,
    timeout: number = AGENT_REPLY_TIMEOUT
  ): Promise<AgentReply> {
    const baseline = await this.agentMessageCount();

    const responsePromise: Promise<Response> = this.page.waitForResponse(
      (r) => ASK_ENDPOINT_RE.test(r.url()) && r.request().method() === 'POST',
      { timeout }
    );

    await this.input.fill(question);
    await expect(this.sendButton).toBeEnabled();

    const startedAt = Date.now();
    await this.sendButton.click();

    const response = await responsePromise;
    const status = response.status();
    expect(
      status,
      `POST ${ASK_ENDPOINT_RE.source} returned ${status}. The agent backend rejected the request, so any UI assertion after this point would be misleading.`
    ).toBe(200);

    await expect(this.agentMessages).toHaveCount(baseline + 1, { timeout });
    await expect(this.input).toBeEnabled({ timeout });

    return {
      text: await this.lastAgentMessage(),
      elapsedMs: Date.now() - startedAt,
      status,
    };
  }

  /** Submit via the keyboard rather than the button. */
  async submitWithEnter(question: string): Promise<void> {
    await this.input.fill(question);
    await this.input.press('Enter');
  }

  /* ---------------------------------------------------------------------------
   * Suggested topics ("pills")
   *
   * The titles are NOT hard-coded anywhere below. They are read from the same
   * endpoint the page itself calls on load, so the pill tests assert the app
   * against its own content source: if someone adds a seventh suggestion or
   * renames one in the CMS, these tests follow it instead of going stale.
   * ------------------------------------------------------------------------- */

  /**
   * The topics the backend serves to an anonymous visitor, in display order.
   *
   * Filtered exactly the way the UI is supposed to filter them - `enabled` and
   * not `for_authenticated` - so the expectation is "what this visitor should
   * see", not "every row in the table".
   */
  async fetchAnonymousSuggestions(): Promise<Suggestion[]> {
    const res = await this.page.request.get(SUGGESTIONS_PATH, { timeout: 20_000 });
    expect(
      res.status(),
      `GET ${SUGGESTIONS_PATH} returned ${res.status()}. Without the served topics there is ` +
        `nothing to compare the page against, so any pill assertion below would be vacuous.`
    ).toBe(200);

    const body = (await res.json()) as Suggestion[];
    expect(Array.isArray(body), `${SUGGESTIONS_PATH} did not return an array: ${JSON.stringify(body)}`).toBe(
      true
    );

    return body
      .filter((s) => s.enabled && !s.for_authenticated)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * A clickable suggested topic, addressed the way a user perceives it: an
   * interactive control whose entire label is the topic title.
   *
   * Two deliberate constraints, both learned the hard way (see the note in
   * artifacts/bug-report.md, BUG-1):
   *
   *   - ANCHORED, whole-label match. A substring matcher on "What is Permission"
   *     matches the agent's own greeting whenever the model happens to write that
   *     phrase, which silently turns a missing-pill failure into a pass.
   *   - INTERACTIVE tags only. The requirement is a pill the user can click, not
   *     the words appearing somewhere on the page.
   *
   * Transcript bubbles are excluded here by `hasNot`, and the resolved element is
   * re-checked against its ancestors in {@link assertPillIsRealControl} before it
   * is clicked - CSS cannot express "not a descendant of", so the ancestor check
   * has to happen in the page.
   */
  suggestionPill(title: string): Locator {
    const wholeLabel = new RegExp(`^\\s*${escapeForRegExp(title)}\\s*$`, 'i');
    return this.page
      .locator('button, [role="button"], [role="option"], [role="listitem"], a, li')
      .filter({ hasText: wholeLabel })
      .filter({ hasNot: this.agentMessages })
      .first();
  }

  /**
   * Guards against the false positive that broke the first attempt at this test:
   * confirms the element about to be clicked is neither part of the chat
   * transcript nor part of the third-party cookie widget.
   */
  async assertPillIsRealControl(pill: Locator, title: string): Promise<void> {
    const provenance = await pill.evaluate((el) => ({
      inTranscript: !!el.closest('div.rounded-lg[class*="fit-content"]'),
      inVendorWidget: !!el.closest('#onetrust-consent-sdk'),
      tag: el.tagName,
    }));
    expect(
      provenance.inTranscript,
      `The element matching "${title}" is inside a chat bubble (<${provenance.tag}>), not a suggested-topic pill. ` +
        `The agent quoting the topic back is not the feature under test.`
    ).toBe(false);
    expect(
      provenance.inVendorWidget,
      `The element matching "${title}" belongs to the OneTrust consent widget, not the app.`
    ).toBe(false);
  }

  /**
   * Polls the page until every served topic has a visible control, or the budget
   * runs out. Returns the LAST report either way, so the caller can assert on it
   * and attach it as evidence rather than reporting a bare timeout.
   */
  async waitForSuggestionPills(
    titles: string[],
    timeout: number = PILL_RENDER_TIMEOUT
  ): Promise<PillReport> {
    const startedAt = Date.now();
    let report = await this.suggestionPillReport(titles);

    while (
      report.pills.some((p) => !p.found || !p.visible) &&
      Date.now() - startedAt < timeout
    ) {
      await this.page.waitForTimeout(500);
      report = await this.suggestionPillReport(titles);
    }

    report.waitedMs = Date.now() - startedAt;
    return report;
  }

  /**
   * One snapshot of the pill surface.
   *
   * Runs in the page because the checks it needs - walking ancestors to reject
   * transcript/vendor matches, and comparing against raw HTML - cannot be done
   * from a locator. `titlesInRawHtml` is what separates the two possible
   * diagnoses: a title in the HTML but not visible means CSS is hiding it; a
   * title in neither means the data was fetched and thrown away.
   */
  async suggestionPillReport(titles: string[]): Promise<PillReport> {
    const snapshot = await this.page.evaluate((wanted) => {
      const normalise = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
      const isVisible = (el: Element) => {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return false;
        }
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };

      const candidates = Array.from(
        document.querySelectorAll(
          'button, [role="button"], [role="option"], [role="listitem"], a, li'
        )
      ).filter(
        (el) =>
          !el.closest('div.rounded-lg[class*="fit-content"]') && !el.closest('#onetrust-consent-sdk')
      );

      return {
        pills: wanted.map((title) => {
          const el = candidates.find((c) => normalise(c.textContent) === normalise(title));
          return {
            title,
            found: !!el,
            visible: el ? isVisible(el) : false,
            tag: el ? el.tagName.toLowerCase() : null,
            testid: el ? el.getAttribute('data-testid') : null,
          };
        }),
        titlesInBodyText: wanted.filter((t) => document.body.innerText.includes(t)),
        titlesInRawHtml: wanted.filter((t) => document.documentElement.outerHTML.includes(t)),
        interactiveNames: candidates
          .filter(isVisible)
          .map((el) => normalise(el.textContent))
          .filter(Boolean),
      };
    }, titles);

    return { ...snapshot, waitedMs: 0 };
  }
}
