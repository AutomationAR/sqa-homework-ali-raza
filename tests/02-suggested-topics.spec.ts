import { test, expect } from './fixtures/base';
import {
  ASK_ENDPOINT_RE,
  AGENT_REPLY_TIMEOUT,
  PILL_RENDER_TIMEOUT,
  SUGGESTIONS_PATH,
} from './pages/ask-page';
import { gradeRelevance, MIN_SUBSTANTIVE_LENGTH } from '../eval/relevance-grader';

/**
 * TEST 2 - the suggested topics, both required behaviours in one test.
 *
 * READ THIS BEFORE RUNNING. This test is KNOWN-FAILING against production and is
 * annotated `test.fail()`, so a clean run reports it as "expected failure" and the
 * suite stays green (`8 passed`, exit 0). It asserts a real, currently-broken
 * product contract: GET /api/agent/suggestions-unauthenticated returns 200 with six
 * enabled anonymous topics, and the page renders none of them (BUG-1 in
 * artifacts/bug-report.md, re-verified 2026-08-15).
 *
 * Why the two required behaviours - "the pills are visible" and "clicking one
 * produces a response" - are one test rather than two: the second is unreachable
 * without the first, so as separate tests they would fail on the identical
 * assertion and report the same defect twice, inside an 8-test budget. Merged, the
 * test walks the whole user journey and stops at the first thing that is broken.
 *
 * Why annotated rather than left red: a permanently-red suite is a suite people
 * stop reading, and this failure is not a regression the current run introduced.
 * Why annotated rather than deleted: `test.fail()` fails when the test PASSES, so
 * the moment the app renders the pills this reports "expected failure did not
 * occur" and fails the build - forcing the annotation off and turning it into an
 * ordinary green test. Neither the defect nor the fix can pass unnoticed.
 *
 * To run it as an ordinary strict expectation - to verify a fix, or to see the
 * defect in red - set EXPECT_PILLS:
 *
 *   PowerShell:  $env:EXPECT_PILLS=1; npx playwright test 02-suggested
 *   bash:        EXPECT_PILLS=1 npx playwright test 02-suggested
 *
 * An annotated test invites a fair challenge: is it asserting anything at all, or
 * would it fail whatever the app did? `npm run verify:pills` answers that on the
 * live page - it injects the pill markup the app SHOULD render and every assertion
 * below passes end to end, then injects a chat bubble whose text is exactly a topic
 * title and the pill count is still zero.
 *
 * That second control is not hypothetical. The first attempt at this test used
 * `getByText(title, { exact: false })`, which matched the agent's own greeting when
 * the model happened to say "what is Permission" - and under `test.fail()` a
 * satisfied assertion reports the defect as FIXED. The hole is closed three ways:
 * the match is anchored to a control's whole label, only interactive elements
 * count, and the resolved element's ancestors are checked before it is clicked
 * (tests/pages/ask-page.ts -> suggestionPill / assertPillIsRealControl).
 */

/** Set EXPECT_PILLS to hold the app to the contract instead of tracking the defect. */
const STRICT_PILLS = !!process.env.EXPECT_PILLS;

const BUG_1 =
  'BUG-1: the API serves enabled anonymous suggested topics and the page renders none of them. ' +
  'Annotated test.fail() so the suite stays green; run with EXPECT_PILLS=1 to assert strictly.';

test('suggested topics render as pills, and clicking one produces an agent reply', async ({
  askPage,
  page,
}) => {
  test.fail(!STRICT_PILLS, BUG_1);

  /* ---------------------------------------------------------------------------
   * 1. Precondition - the content the page needs exists.
   *
   * The expectation is built from the app's own content API rather than six
   * hard-coded strings, so renaming or adding a topic in the CMS does not make
   * this test lie. This half PASSES today.
   * ------------------------------------------------------------------------- */
  const suggestions = await askPage.fetchAnonymousSuggestions();
  expect(
    suggestions.length,
    `${SUGGESTIONS_PATH} served no enabled anonymous topics, so there is nothing the page could ` +
      `be expected to render and this test would pass vacuously.`
  ).toBeGreaterThan(0);

  const titles = suggestions.map((s) => s.title);

  /* An enabled topic with an empty prompt would render a pill that sends nothing. */
  for (const s of suggestions) {
    expect(s.title.trim(), `Topic ${s.id} has an empty title.`).not.toBe('');
    expect(s.prompt.trim(), `Topic "${s.title}" has an empty prompt.`).not.toBe('');
  }

  /* ---------------------------------------------------------------------------
   * 2. REQUIRED: the page loads with the suggested-topic pills visible.
   *
   * This is where the test fails today.
   * ------------------------------------------------------------------------- */
  const report = await askPage.waitForSuggestionPills(titles, PILL_RENDER_TIMEOUT);

  await test.info().attach('suggestion-pill-report.json', {
    body: JSON.stringify({ served: suggestions, report }, null, 2),
    contentType: 'application/json',
  });

  const missing = report.pills.filter((p) => !p.found || !p.visible);

  /* The diagnosis is asserted, not just the outcome. `titlesInRawHtml` is the
   * discriminator: present means the markup was rendered and then hidden by CSS,
   * absent means the payload was fetched and discarded. Today it is the second,
   * which is what makes BUG-1 a data-handling defect rather than a styling one. */
  const diagnosis = report.titlesInRawHtml.length
    ? `The titles ARE in the served markup (${report.titlesInRawHtml.join(', ')}) but no visible ` +
      `control carries them - they are rendered and then hidden.`
    : `None of the titles appear in the page's raw HTML at all, so the payload was fetched and ` +
      `discarded rather than hidden by CSS.`;

  expect(
    missing.map((p) => p.title),
    `${report.pills.length - missing.length}/${report.pills.length} suggested topics rendered as ` +
      `visible pills after ${report.waitedMs}ms.\n` +
      `  ${diagnosis}\n` +
      `  served by ${SUGGESTIONS_PATH}: ${titles.join(' | ')}\n` +
      `  visible interactive controls on the page: ${report.interactiveNames.join(' | ')}\n` +
      `  titles found in visible page text (bubbles included): ${
        report.titlesInBodyText.join(' | ') || 'none'
      }`
  ).toEqual([]);

  /* ---------------------------------------------------------------------------
   * 3. REQUIRED: clicking a suggested topic produces an agent response.
   *
   * Everything below is unreachable until BUG-1 is fixed, and is verified against
   * injected pills by `npm run verify:pills` so it is known to work.
   * ------------------------------------------------------------------------- */

  /* Take the first SERVED topic, so the click follows the API's own `order`
   * rather than DOM order. */
  const topic = suggestions[0];
  const pill = askPage.suggestionPill(topic.title);
  await askPage.assertPillIsRealControl(pill, topic.title);

  const baseline = await askPage.agentMessageCount();
  const responsePromise = page.waitForResponse(
    (r) => ASK_ENDPOINT_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: AGENT_REPLY_TIMEOUT }
  );

  await pill.click();

  /* NETWORK - the click asks the agent, and asks it the right thing. A
   * bubble-count-only check would pass a pill wired to the wrong topic. */
  const response = await responsePromise;
  expect(
    response.status(),
    `Clicking "${topic.title}" produced POST ${response.url()} -> ${response.status()}.`
  ).toBe(200);

  const sent = String(response.request().postDataJSON()?.message ?? '').trim().toLowerCase();
  expect(
    [topic.prompt.trim().toLowerCase(), topic.title.trim().toLowerCase()],
    `Clicking the "${topic.title}" pill sent message="${sent}", which is neither its configured ` +
      `prompt ("${topic.prompt}") nor its title. The pill is wired to the wrong text.`
  ).toContain(sent);

  /* DOM - a reply is rendered, and the composer is handed back. */
  await expect(askPage.agentMessages).toHaveCount(baseline + 1, { timeout: AGENT_REPLY_TIMEOUT });
  await expect(askPage.input).toBeEnabled({ timeout: AGENT_REPLY_TIMEOUT });

  /* CONTENT - the reply answers the topic that was clicked, graded by the same
   * rubric the promptfoo eval uses. */
  const reply = await askPage.lastAgentMessage();
  expect(
    reply.length,
    `Reply to "${topic.title}" was ${reply.length} chars: "${reply}"`
  ).toBeGreaterThan(MIN_SUBSTANTIVE_LENGTH);

  const verdict = await gradeRelevance(topic.prompt, reply);
  expect(
    verdict.pass,
    `Relevance grader (${verdict.mode}) rejected the reply to the "${topic.title}" pill.\n` +
      `  prompt: ${topic.prompt}\n  reply:  ${reply}\n  reason: ${verdict.reason}`
  ).toBe(true);
});
