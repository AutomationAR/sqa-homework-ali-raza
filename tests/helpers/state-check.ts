import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Guards that every test in this suite really is exercising the ANONYMOUS,
 * pre-login experience.
 *
 * Playwright already gives each test a fresh browser context, and the config
 * pins an empty `storageState` on top of that, so a leaked session is not
 * possible today - there is no auth project and no global setup. These
 * assertions exist so that if that ever changes (someone adds a signed-in
 * project, a global setup, or points the suite at a pre-warmed profile), the
 * failure reads
 *
 *   "Test context is not anonymous: 4 cookie(s) present before navigation"
 *
 * instead of a downstream mystery like "expected 6 pills, found 0". Cheap
 * assertions whose only job is to make one specific misdiagnosis impossible.
 *
 * Signals chosen from recon rather than guessed. `log-in-button` /
 * `sign-up-button` are present anonymous and absent authenticated;
 * `user-widget-button` / `notification-widget-button` are the exact inverse
 * (artifacts/recon/02-inventory.json vs
 * artifacts/recon/authenticated/desktop-00-landing-inventory.json). Asserting
 * both directions is what makes this a state check and not just a
 * "did the header render" check.
 */

/** Must be called BEFORE the first navigation: after it, the app itself writes
 *  localStorage and OneTrust sets consent cookies, so a non-empty state is
 *  expected and this check would be meaningless. */
export async function assertCleanContext(context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  expect(
    state.cookies.length,
    `Test context is not clean: ${state.cookies.length} cookie(s) present before navigation ` +
      `(${state.cookies.map((c) => c.name).join(', ')}). This suite tests the pre-login ` +
      `experience and must start from an empty context.`
  ).toBe(0);
  expect(
    state.origins.length,
    `Test context is not clean: origin storage present before navigation for ` +
      `${state.origins.map((o) => o.origin).join(', ')}. This suite tests the pre-login ` +
      `experience and must start from an empty context.`
  ).toBe(0);
}

/**
 * Must be called AFTER the page has loaded. Asserts the rendered UI is the
 * unauthenticated one, from both directions.
 */
export async function assertAnonymousUi(page: Page): Promise<void> {
  await expect(
    page.getByTestId('log-in-button'),
    'No "Log in" control on the page - this looks like the authenticated UI, not the ' +
      'pre-login experience this suite asserts against.'
  ).toBeVisible();
  await expect(page.getByTestId('sign-up-button')).toBeVisible();

  /* Authenticated-only header controls. Count, not visibility: an authenticated
   * widget that renders offscreen is still the wrong state. */
  await expect(
    page.getByTestId('user-widget-button'),
    'Authenticated user widget is present - the browser context carried a session ' +
      'into a test that must run anonymously.'
  ).toHaveCount(0);
  await expect(page.getByTestId('notification-widget-button')).toHaveCount(0);
}
