import { test, expect } from './fixtures/base';

/**
 * TEST 7 - the unauthenticated visitor can reach a usable login form.
 *
 * Scope is navigation and form readiness, NOT authentication. Signing in for
 * real would bind the suite to one live account's state and to email/rate-limit
 * behaviour outside our control, for no extra signal about the page under test.
 * Post-signup observations are covered by hand in artifacts/ux-review.md.
 *
 * Note the header controls are <button> elements with no href, not links - so a
 * naive a[href*="login"] locator finds nothing here.
 */
test('Log in navigates to a usable login form', async ({ askPage, page }) => {
  await expect(askPage.loginButton).toBeVisible();
  await askPage.loginButton.click();

  await expect(page).toHaveURL(/\/login\b/);

  /* The form is present, labelled, and ready for input. */
  await expect(page.getByTestId('login-title-heading')).toHaveText(/log in to your account/i);

  const email = page.getByTestId('login-email-input');
  const password = page.getByTestId('login-password-input');
  const submit = page.getByTestId('login-submit-button');

  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('type', 'email');
  await expect(password).toBeVisible();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(submit).toBeVisible();

  /* Genuinely editable, not a decorative or disabled shell. Filled with an
   * obvious non-account value; never submitted. */
  await email.fill('qa-probe@example.invalid');
  await expect(email).toHaveValue('qa-probe@example.invalid');
  await password.fill('not-a-real-password');
  await expect(password).toHaveValue('not-a-real-password');
  await expect(submit).toBeEnabled();

  /* Recovery and sign-up routes out of a failed login exist. */
  await expect(page.getByTestId('login-forgot-password-link')).toBeVisible();
  await expect(page.getByTestId('login-signup-link')).toBeVisible();
});
