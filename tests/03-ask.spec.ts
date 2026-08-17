import { test, expect } from './fixtures/base';
import { ASK_ENDPOINT_RE, AGENT_REPLY_TIMEOUT } from './pages/ask-page';
import {
  gradeRelevance,
  isLlmModeAvailable,
  MIN_SUBSTANTIVE_LENGTH,
} from '../eval/relevance-grader';

/** Counts POSTs to the agent endpoint for the lifetime of the page. */
function countAskPosts(page: import('@playwright/test').Page): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (ASK_ENDPOINT_RE.test(r.url()) && r.method() === 'POST') n += 1;
  });
  return () => n;
}

test.describe('ASK submission', () => {
  /**
   * TEST 3 - the headline behaviour: a free-text question gets a real answer.
   *
   * This is where the LLM-evaluation framework is wired into the live suite.
   * The reply is graded by eval/relevance-grader.js - the exact module that
   * promptfoo evaluates against a golden dataset in eval/promptfooconfig.yaml.
   * A structural "the bubble is non-empty" check cannot tell a correct answer
   * from a fluent answer about the weather; the grader can.
   *
   * The question is not hard-coded: it is the top-ordered prompt the app's own
   * content API serves for the suggested topics, typed into the composer as free
   * text. Two things for the price of one - the free-text submission path, and the
   * fact that the topics the CMS is publishing are still answerable. The second is
   * currently invisible to everyone, because BUG-1 means nobody can click them
   * (see test 2). If a topic is renamed to something the agent cannot answer, this
   * test says so.
   */
  test('a free-text question returns a substantive, on-topic agent reply', async ({ askPage }) => {
    const topics = await askPage.fetchAnonymousSuggestions();
    expect(topics.length, 'No served topic to ask about.').toBeGreaterThan(0);
    const question = topics[0].prompt;

    const reply = await askPage.askAndWaitForReply(question);

    /* Structural floor first - cheap, and gives a clearer failure than the
     * grader would if the bubble came back blank. */
    expect(reply.status).toBe(200);
    expect(
      reply.text.length,
      `Reply was ${reply.text.length} chars: "${reply.text}"`
    ).toBeGreaterThan(MIN_SUBSTANTIVE_LENGTH);

    /* Semantic gate: the assertion backed by the eval framework. */
    const verdict = await gradeRelevance(question, reply.text);

    await test.info().attach('relevance-verdict.json', {
      body: JSON.stringify({ question, reply: reply.text, verdict }, null, 2),
      contentType: 'application/json',
    });

    expect(
      verdict.pass,
      `Relevance grader (${verdict.mode}) rejected the reply.\n` +
        `  question: ${question}\n` +
        `  reply:    ${reply.text}\n` +
        `  score:    ${verdict.score}\n` +
        `  reason:   ${verdict.reason}`
    ).toBe(true);

    /* Visible in the HTML report so a reviewer can see which grader ran. */
    console.log(
      `[relevance] mode=${verdict.mode} score=${verdict.score} llmAvailable=${isLlmModeAvailable()} replyMs=${reply.elapsedMs}`
    );
  });

  /**
   * TEST 4 - the app's real "busy" contract.
   *
   * There is no spinner, no typing dots and no streaming indicator anywhere in
   * this app: recon polled every 400ms through a full request and found zero
   * elements matching animate/pulse/spin/bounce, and a constant SVG count
   * (artifacts/recon/53-inflight-poll.json). The reply arrives as one atomic
   * JSON payload, not a token stream.
   *
   * What the app ACTUALLY does while a request is in flight is disable the
   * textarea and clear it. That is the observable state worth protecting,
   * because it is also what prevents a double-submit - so this test asserts the
   * guard holds by trying to submit again mid-flight.
   */
  test('composer locks while a reply is in flight and unlocks afterwards', async ({ askPage }) => {
    const askPosts = countAskPosts(askPage.page);
    const postsBeforeSubmit = askPosts();
    const baseline = await askPage.agentMessageCount();

    await askPage.input.fill('What is passive earning?');
    await expect(askPage.sendButton).toBeEnabled();

    const responsePromise = askPage.page.waitForResponse(
      (r) => ASK_ENDPOINT_RE.test(r.url()) && r.request().method() === 'POST',
      { timeout: AGENT_REPLY_TIMEOUT }
    );
    await askPage.sendButton.click();

    /* In flight: locked, cleared, and the send button re-disabled. */
    await expect(askPage.input).toBeDisabled({ timeout: 5_000 });
    await expect(askPage.input).toHaveValue('');
    await expect(askPage.sendButton).toBeDisabled();

    /* Double-submit guard: hammering Enter while locked must not queue a second
     * request. Dispatched at the keyboard level rather than via the locator,
     * because locator.press() would block waiting for the disabled textarea to
     * become actionable and we specifically want the event delivered anyway. */
    await askPage.page.keyboard.press('Enter');
    await askPage.page.keyboard.press('Enter');

    await responsePromise;
    await expect(askPage.agentMessages).toHaveCount(baseline + 1, {
      timeout: AGENT_REPLY_TIMEOUT,
    });

    /* Settled: composer handed back to the user, ready for a follow-up. */
    await expect(askPage.input).toBeEnabled({ timeout: AGENT_REPLY_TIMEOUT });
    await expect(askPage.input).toHaveValue('');
    await expect(askPage.sendButton).toBeDisabled();

    expect(
      askPosts() - postsBeforeSubmit,
      'Exactly one agent request should result from one submit; more means the in-flight lock leaks a duplicate.'
    ).toBe(1);
  });

  /**
   * TEST 5 - honours the keyboard contract the UI advertises on screen
   * ("Press Shift + Enter for new line."). Test 1 asserts the hint is shown;
   * this asserts it is true.
   */
  test('Shift+Enter inserts a newline instead of submitting', async ({ askPage }) => {
    const askPosts = countAskPosts(askPage.page);
    const postsBefore = askPosts();
    const baseline = await askPage.agentMessageCount();

    await askPage.input.click();
    await askPage.input.fill('First line');
    await askPage.input.press('Shift+Enter');
    await askPage.input.pressSequentially('Second line');

    const value = await askPage.input.inputValue();
    expect(value).toContain('\n');
    expect(value).toBe('First line\nSecond line');

    /* Nothing was sent: no request, no new agent bubble, text still in the box.
     * Waiting a beat first so a submit would have had time to fire. */
    await askPage.page.waitForTimeout(1_500);
    expect(askPosts() - postsBefore, 'Shift+Enter must not submit.').toBe(0);
    await expect(askPage.agentMessages).toHaveCount(baseline);
    await expect(askPage.input).toBeEnabled();
    await expect(askPage.sendButton).toBeEnabled();
  });

  /**
   * TEST 6 - empty submission is rejected on BOTH submit paths.
   *
   * Testing both paths matters: a button-only guard is a common bug, where the
   * disabled attribute hides an unvalidated keyboard handler. Recon confirmed
   * this app gets it right, so this test locks that in against regression.
   */
  test('empty and whitespace-only submissions are rejected on both submit paths', async ({
    askPage,
  }) => {
    const askPosts = countAskPosts(askPage.page);
    const postsBefore = askPosts();
    const baseline = await askPage.agentMessageCount();

    /* Path A - the button, with nothing typed. */
    await expect(askPage.input).toHaveValue('');
    await expect(askPage.sendButton).toBeDisabled();

    /* Path A - the button, with whitespace only. The guard must trim. */
    await askPage.input.fill('     ');
    await expect(
      askPage.sendButton,
      'Send must stay disabled for whitespace-only input, i.e. the guard trims.'
    ).toBeDisabled();

    /* Path B - the Enter key, with whitespace only. */
    await askPage.input.press('Enter');
    await askPage.page.waitForTimeout(1_500);

    /* Path B - the Enter key, with a genuinely empty box. */
    await askPage.input.fill('');
    await askPage.input.press('Enter');
    await askPage.page.waitForTimeout(1_500);

    expect(
      askPosts() - postsBefore,
      'No agent request may be issued for empty or whitespace-only input, via button or Enter.'
    ).toBe(0);
    await expect(askPage.agentMessages).toHaveCount(baseline);
    await expect(askPage.input).toBeEnabled();
  });
});
