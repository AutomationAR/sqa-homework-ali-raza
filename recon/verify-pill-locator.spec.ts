import { test, expect } from '../tests/fixtures/base';
import { ASK_ENDPOINT_RE, AGENT_REPLY_TIMEOUT } from '../tests/pages/ask-page';

/**
 * Self-check for test 2, the suggested-topic test (tests/02-suggested-topics.spec.ts).
 *
 * That test is annotated `test.fail()` because the app renders no pills (BUG-1).
 * An annotated test raises a fair question: is it asserting anything at all, or
 * would it fail no matter what the app did? This file answers it by running its
 * machinery against BOTH outcomes, on the live page:
 *
 *   1. PILLS EXIST  - inject the markup the app is supposed to render (six
 *      buttons wired to the composer, built from the app's own API payload), then
 *      run test 2's locator, provenance check, click and network assertions. All
 *      pass. So the moment BUG-1 is fixed that test goes green; until then its
 *      failure is the product's, not the locator's.
 *
 *   2. ONLY THE TRANSCRIPT SAYS IT - inject a chat bubble whose text is exactly a
 *      topic title, including a link inside it. The report still finds zero
 *      pills. This is the false positive that killed the first attempt at that
 *      test (a substring matcher scored the agent's own greeting as a pill and
 *      reported the defect as fixed), so it is pinned down here rather than
 *      trusted.
 *
 * Lives in recon/ because it mutates the page under test, which a real test must
 * never do. Run: npm run verify:pills
 */

/** Use a large desktop viewport for reliable DOM inspection. */
test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
});

/** The pill implementation the app is missing, injected for the positive control. */
const INJECT_PILLS = (topics: Array<{ title: string; prompt: string }>) => {
  const strip = document.createElement('div');
  strip.id = 'qa-injected-suggestions';
  strip.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:12px;';

  for (const topic of topics) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = topic.title;
    pill.style.cssText = 'padding:6px 12px;border:1px solid #888;border-radius:999px;';
    pill.addEventListener('click', () => {
      const box = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="agent-chat-input"]'
      );
      const send = document.querySelector<HTMLButtonElement>(
        '[data-testid="agent-chat-input-send-button"]'
      );
      if (!box || !send) return;
      /* React owns this textarea, so set through the native setter and fire the
       * event React listens for - assigning .value directly is ignored. */
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!;
      setValue.call(box, topic.prompt);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => send.click(), 50);
    });
    strip.appendChild(pill);
  }

  const composer = document.querySelector('[data-testid="agent-chat-input"]');
  (composer?.parentElement ?? document.body).prepend(strip);
};

test.beforeEach(async ({ page }) => {
  /* Always start from a clean reload to avoid stale state from the previous
   * test or any persisted auth/cookies. */
  await page.goto('https://ask.permission.ai/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  await page.reload({ waitUntil: 'networkidle' });
  
  /* Extra safety: wait for the app shell to be interactive before asserting. */
  await page.waitForSelector('[data-testid="agent-chat-input"]', { timeout: 15_000 });
});

test('positive control: with pills present, test 2 passes end to end', async ({
  askPage,
  page,
}) => {
  /* Fresh reload already done in beforeEach; now fetch suggestions from the API. */
  const suggestions = await askPage.fetchAnonymousSuggestions();
  expect(suggestions.length).toBeGreaterThan(0);
  const titles = suggestions.map((s) => s.title);

  /* Before: the defect. This is what the suite sees on production today. */
  const before = await askPage.suggestionPillReport(titles);
  expect(
    before.pills.filter((p) => p.found).length,
    'Sanity check for this control: the real app should render no pills.'
  ).toBe(0);

  await page.evaluate(INJECT_PILLS, suggestions.map((s) => ({ title: s.title, prompt: s.prompt })));

  /* Test 2, step 2 - verbatim in effect: all served topics visible as pills. */
  const after = await askPage.waitForSuggestionPills(titles, 5_000);
  expect(
    after.pills.filter((p) => !p.found || !p.visible),
    'Every injected pill must be detected, or test 2 would fail even on a fixed app.'
  ).toEqual([]);

  /* Test 2, step 3: provenance, click, request payload, rendered reply. */
  const topic = suggestions[0];
  const pill = askPage.suggestionPill(topic.title);
  await askPage.assertPillIsRealControl(pill, topic.title);

  const baseline = await askPage.agentMessageCount();
  const responsePromise = page.waitForResponse(
    (r) => ASK_ENDPOINT_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: AGENT_REPLY_TIMEOUT }
  );

  await pill.click();

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(String(response.request().postDataJSON()?.message ?? '').trim().toLowerCase()).toBe(
    topic.prompt.trim().toLowerCase()
  );

  await expect(askPage.agentMessages).toHaveCount(baseline + 1, { timeout: AGENT_REPLY_TIMEOUT });
  await expect(askPage.input).toBeEnabled({ timeout: AGENT_REPLY_TIMEOUT });

  const reply = await askPage.lastAgentMessage();
  expect(reply.length).toBeGreaterThan(40);
  console.log(`[pill-locator] clicked "${topic.title}" -> ${reply.length} char reply`);
});

test('negative control: a chat bubble quoting a topic title is not counted as a pill', async ({
  askPage,
  page,
}) => {
  /* Fresh reload already done in beforeEach. */
  const suggestions = await askPage.fetchAnonymousSuggestions();
  const titles = suggestions.map((s) => s.title);
  const [decoy] = titles;

  /* The exact shape of the false positive: the title appears in the transcript,
   * as prose AND as a link, which is how a chatty model can produce it. */
  await page.evaluate((text) => {
    const bubble = document.createElement('div');
    bubble.className = 'rounded-lg w-[fit-content] p-4';
    bubble.innerHTML =
      `<p class="leading-relaxed">${text}</p>` + `<a href="#" class="underline">${text}</a>`;
    document.body.appendChild(bubble);
  }, decoy);

  const report = await askPage.suggestionPillReport(titles);

  expect(
    report.titlesInBodyText,
    'Control precondition: the decoy text must really be on the page.'
  ).toContain(decoy);

  expect(
    report.pills.filter((p) => p.found).map((p) => p.title),
    `"${decoy}" is only present inside a chat bubble, so no pill may be reported. ` +
      `A match here is the false positive that reports BUG-1 as fixed.`
  ).toEqual([]);
});