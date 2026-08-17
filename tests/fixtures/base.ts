import { test as base, expect, type Page } from '@playwright/test';
import { AskPage } from '../pages/ask-page';
import { assertAnonymousUi, assertCleanContext } from '../helpers/state-check';

/**
 * Third-party hosts blocked for every test.
 *
 * Two reasons, both practical rather than cosmetic:
 *   1. Running an automated suite against production would otherwise fire real
 *      marketing/analytics events on every run, corrupting the product team's
 *      funnel data with bot traffic.
 *   2. These are cross-origin requests to hosts we do not control. Letting them
 *      run makes suite stability depend on third-party uptime for no signal.
 *
 * Deliberately NOT blocked: api.web3modal.org. That one backs the wallet
 * connect feature, which is app functionality, not telemetry - blocking it
 * would change the behaviour under test.
 */
const BLOCKED_HOSTS = [
  '**://*.posthog.com/**',
  '**://*.reddit.com/**',
  '**://*.redditstatic.com/**',
  '**://*.google-analytics.com/**',
  '**://*.googletagmanager.com/**',
  '**://*.doubleclick.net/**',
  '**://*.facebook.net/**',
];

async function blockTelemetry(page: Page): Promise<void> {
  for (const pattern of BLOCKED_HOSTS) {
    await page.route(pattern, (route) => route.abort());
  }
}

type Fixtures = {
  askPage: AskPage;
  /** Console errors collected across the test, asserted on by the landing spec. */
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
  },

  /**
   * Ready-to-use chat page: verified anonymous, telemetry blocked, cookie wall
   * cleared, greeting rendered.
   *
   * Every spec in this suite asserts the PRE-LOGIN experience, so the anonymous
   * state is asserted here once rather than restated in each test - before
   * navigation (empty context) and after load (unauthenticated UI rendered).
   * See helpers/state-check.ts for why both directions are checked.
   */
  askPage: async ({ page, context, consoleErrors }, use) => {
    void consoleErrors; // ensure the listener is attached before navigation
    await assertCleanContext(context);
    await blockTelemetry(page);
    const askPage = new AskPage(page);
    await askPage.goto();
    await assertAnonymousUi(page);
    await use(askPage);
  },
});

export { expect };
