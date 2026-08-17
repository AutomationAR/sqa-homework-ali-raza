import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Why the suite stops at the login boundary.
 *
 * This file documents the blocker rather than working around it. Credentials are
 * read from the environment and never written to disk; the password is redacted
 * from any captured request body.
 *
 * Run: PERMISSION_EMAIL=... PERMISSION_PASSWORD=... \
 *      npx playwright test --config=recon/recon.config.ts explore-authenticated
 */

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2), 'utf-8');
}

/** Hosts excluded so the authentication backend, if any, is visible. */
const NOISE =
  /google|doubleclick|tiktok|posthog|reddit|facebook|onetrust|cookielaw|web3modal|walletconnect|gstatic|hotjar|clarity|segment|sentry/i;

test('login form is gated by invisible reCAPTCHA', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const captcha = await page.evaluate(() => ({
    grecaptchaType: typeof (window as unknown as { grecaptcha?: unknown }).grecaptcha,
    captchaScripts: Array.from(document.querySelectorAll('script[src]'))
      .map((s) => (s as HTMLScriptElement).src)
      .filter((s) => /recaptcha|captcha|turnstile|hcaptcha/i.test(s)),
    captchaFrames: Array.from(document.querySelectorAll('iframe'))
      .map((f) => (f as HTMLIFrameElement).src)
      .filter((s) => /recaptcha/i.test(s)),
    badgePresent: !!document.querySelector('.grecaptcha-badge'),
  }));

  save('81-recaptcha.json', captcha);
  console.log('RECAPTCHA:', JSON.stringify(captcha, null, 1));
  /* Observed: invisible reCAPTCHA v2 (size=invisible, badge bottom-right,
   * execute-ms=30000). An automated browser cannot mint a token for it, which is
   * exactly what bot protection is for. */
});

test('submitting real credentials issues no auth request (read-only)', async ({ page }) => {
  const EMAIL = process.env.PERMISSION_EMAIL;
  const PASSWORD = process.env.PERMISSION_PASSWORD;
  test.skip(!EMAIL || !PASSWORD, 'PERMISSION_EMAIL / PERMISSION_PASSWORD not set');

  const calls: string[] = [];
  const interesting = (u: string) => {
    try {
      const url = new URL(u);
      if (NOISE.test(url.hostname)) return false;
      return !/\.(js|css|png|jpg|svg|woff2?|ico|map)$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  page.on('request', (r) => {
    if (!interesting(r.url())) return;
    const u = new URL(r.url());
    const body = (r.postData() ?? '').replace(/("password"\s*:\s*")[^"]*/, '$1<redacted>').slice(0, 180);
    calls.push(`REQ ${r.method()} ${u.hostname}${u.pathname} ${body}`);
  });
  page.on('requestfailed', (r) => {
    if (!interesting(r.url())) return;
    const u = new URL(r.url());
    calls.push(`FAIL ${r.method()} ${u.hostname}${u.pathname} :: ${r.failure()?.errorText}`);
  });

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.locator('#onetrust-reject-all-handler').click().catch(() => {});
  await page.waitForTimeout(800);

  calls.length = 0;
  consoleErrors.length = 0;

  await page.getByTestId('login-email-input').fill(EMAIL!);
  await page.getByTestId('login-password-input').fill(PASSWORD!);

  const submit = page.getByTestId('login-submit-button');
  await submit.click();

  /* Watch the button and the URL for 20s. */
  const timeline: string[] = [];
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(2500);
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const feedback = bodyText.match(/(invalid|incorrect|failed|error|unverified|try again)[^.]{0,70}/i);
    timeline.push(
      `t=${i * 2.5}s path=${new URL(page.url()).pathname} submitDisabled=${await submit
        .isDisabled()
        .catch(() => 'n/a')}${feedback ? ` FEEDBACK="${feedback[0]}"` : ''}`
    );
  }

  save('82-login-outcome.json', { timeline, calls, consoleErrors, finalUrl: page.url() });

  /* Deliberately no screenshot here. The evidence is textual, and a screenshot of
   * a filled login form would commit the account's email address to the repo.
   * An earlier scratch capture also dumped an ARIA snapshot of the filled form,
   * which recorded the PASSWORD in plaintext - that file has been purged. */

  console.log('TIMELINE:\n  ' + timeline.join('\n  '));
  console.log('NON-NOISE TRAFFIC AFTER SUBMIT:', calls.length === 0 ? '(none)' : '\n  ' + calls.join('\n  '));
  console.log('CONSOLE ERRORS:', consoleErrors.length === 0 ? '(none)' : consoleErrors.join(' | '));

  /* Observed outcome: the submit button goes disabled on click and STAYS
   * disabled indefinitely; no authentication request is issued to any host; no
   * console error; no message shown to the user. The reCAPTCHA token never
   * resolves under automation and the handler has no timeout or error path.
   *
   * Two conclusions:
   *   1. Automated post-login coverage is not achievable without a captcha
   *      bypass, so the suite is scoped to the unauthenticated surface.
   *   2. The silent dead-end is a real UX defect for humans too - any user whose
   *      captcha fails to resolve gets a permanently dead button with no
   *      feedback. Logged in artifacts/ux-review.md.
   */
});
