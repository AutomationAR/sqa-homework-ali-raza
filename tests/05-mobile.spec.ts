import { test, expect } from './fixtures/base';

/**
 * TEST 8 - mobile layout integrity. Runs ONLY in the mobile-chrome project
 * (Pixel 5, 393x851) via testMatch in playwright.config.ts.
 *
 * This is the one test where the viewport is the subject, so it asserts things
 * that can only break on a small screen: horizontal overflow, elements pushed
 * out of the viewport, and tap targets too small to hit.
 */
test('mobile viewport renders the chat without overflow and with reachable targets', async ({
  askPage,
  page,
}) => {
  const viewport = page.viewportSize();
  expect(viewport, 'This test requires a fixed viewport.').not.toBeNull();
  const width = viewport!.width;

  /* Key elements survive the narrow viewport. */
  await expect(askPage.agentTitle).toBeVisible();
  await expect(askPage.input).toBeVisible();
  await expect(askPage.sendButton).toBeVisible();
  await expect(askPage.loginButton).toBeVisible();
  await expect(askPage.signUpButton).toBeVisible();
  await expect(askPage.agentMessages.first()).toBeVisible();

  /* No horizontal scroll. A 1px overflow is enough to make a mobile page feel
   * broken, and it is the single most common small-screen regression. */
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `Document scrollWidth ${scrollWidth} exceeds viewport ${clientWidth} - the page scrolls sideways.`
  ).toBeLessThanOrEqual(clientWidth);

  /* Composer sits fully inside the viewport horizontally. */
  const inputBox = await askPage.input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.x).toBeGreaterThanOrEqual(0);
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(width);

  /* Send button is a hittable target. WCAG 2.2 SC 2.5.8 (AA) sets the floor at
   * 24x24 CSS px; the observed button is 41x36, which clears AA but is under the
   * 44x44 iOS/Material recommendation - noted in artifacts/ux-review.md. */
  const sendBox = await askPage.sendButton.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox!.width, 'Send button width below the WCAG 2.5.8 24px floor.').toBeGreaterThanOrEqual(24);
  expect(sendBox!.height, 'Send button height below the WCAG 2.5.8 24px floor.').toBeGreaterThanOrEqual(24);

  /* Composer and send button do not overlap - they are laid out side by side,
   * and a wrap failure at this width would stack them on top of each other. */
  expect(
    inputBox!.x + inputBox!.width,
    'Input and send button overlap at mobile width.'
  ).toBeLessThanOrEqual(sendBox!.x + 1);

  /* The composer is reachable without scrolling: it is the primary action. */
  expect(
    inputBox!.y,
    'Composer starts below the fold on a Pixel 5 viewport.'
  ).toBeLessThan(viewport!.height);
});
