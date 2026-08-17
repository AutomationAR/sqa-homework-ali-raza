import { test, expect } from './fixtures/base';

/**
 * Landing / first-impression surface. Everything here must hold before a user
 * has typed anything.
 *
 * Suggested-topic pills are part of this surface too, but they get their own spec
 * (02-suggested-topics) because that test is annotated `test.fail()` against BUG-1
 * and is easier to run, read and explain on its own.
 */
test.describe('Landing page', () => {
  /**
   * TEST 1 - the composer and its affordances are present and in the right
   * initial state.
   *
   * Note what is NOT asserted: the greeting's text. The app generates the
   * greeting by POSTing message:"hi" to the agent on load, so it is a fresh LLM
   * completion every time - recon captured "Hello! I'm your Permission Agent...",
   * "Hello! How can I help you today?" and "Hello there. How can I assist you
   * today?" across three loads. Asserting that string would be a guaranteed
   * flake. We assert a greeting EXISTS and is substantive instead.
   */
  test('renders the chat composer and agent identity in a usable initial state', async ({
    askPage,
    consoleErrors,
  }) => {
    await expect(askPage.agentTitle).toHaveText('Permission Agent');
    await expect(askPage.agentDescription).toHaveText('Here to help you Earn More');

    /* Exactly one bubble on a fresh load - the greeting - and it says something. */
    await expect(askPage.agentMessages).toHaveCount(1);
    await expect(askPage.agentMessages.first()).toBeVisible();
    const greeting = await askPage.agentMessageText(0);
    expect(greeting.length, `Greeting bubble was "${greeting}"`).toBeGreaterThan(10);

    /* Composer: present, editable, correctly labelled, and guarded. */
    await expect(askPage.input).toBeVisible();
    await expect(askPage.input).toBeEnabled();
    await expect(askPage.input).toHaveAttribute('placeholder', 'ASK anything...');
    await expect(askPage.input).toHaveValue('');

    /* Send is disabled until there is something to send - this is the app's
     * own empty-submission guard, verified again from the user side in test 6. */
    await expect(askPage.sendButton).toBeDisabled();

    /* The keyboard contract the app advertises to the user. Test 5 proves the
     * advertised behaviour is real. */
    await expect(askPage.shiftEnterHint).toBeVisible();

    /* Unauthenticated entry points. */
    await expect(askPage.loginButton).toBeVisible();
    await expect(askPage.signUpButton).toBeVisible();

    /* No uncaught exceptions during first load. Scoped to pageerror only:
     * console.error noise from the analytics hosts we deliberately abort in the
     * fixture would otherwise fail this for our own reasons, not the app's. */
    const uncaught = consoleErrors.filter((e) => e.startsWith('pageerror:'));
    expect(uncaught, `Uncaught exceptions on load:\n${uncaught.join('\n')}`).toEqual([]);
  });
});
