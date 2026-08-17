import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Does the authenticated header render on first paint, or does an authenticated
 * user see "Log in / Sign Up" first?
 *
 * The post-login capture recorded the MOBILE landing page showing "Log in" and
 * "Sign Up" while the same session showed "Welcome Ali!" on another route two
 * minutes later. This measures whether that is a real flash of unauthenticated
 * state and how long it lasts.
 *
 * Requires .auth-state.json from `npm run capture:auth` (gitignored, live tokens).
 * Run: npx playwright test --config=recon/recon.config.ts auth-hydration
 */

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');
const STATE = path.join(__dirname, '..', '.auth-state.json');

/** Samples the header until the authenticated widget appears, or timeout. */
async function measure(page: import('@playwright/test').Page, label: string) {
  const samples: { tMs: number; loggedOutCtas: number; userWidget: number }[] = [];
  const started = Date.now();

  for (let i = 0; i < 40; i++) {
    const s = await page
      .evaluate(() => ({
        loggedOutCtas: document.querySelectorAll(
          '[data-testid="log-in-button"],[data-testid="sign-up-button"]'
        ).length,
        userWidget: document.querySelectorAll('[data-testid="user-widget-button"]').length,
      }))
      .catch(() => ({ loggedOutCtas: -1, userWidget: -1 }));
    samples.push({ tMs: Date.now() - started, ...s });
    if (s.userWidget > 0) break;
    await page.waitForTimeout(250);
  }

  const firstAuth = samples.find((s) => s.userWidget > 0);
  const lastLoggedOut = [...samples].reverse().find((s) => s.loggedOutCtas > 0);

  console.log(`\n### ${label}`);
  console.log(`  authenticated header appeared at: ${firstAuth ? firstAuth.tMs + 'ms' : 'NEVER (within 10s)'}`);
  console.log(`  logged-out CTAs last seen at:     ${lastLoggedOut ? lastLoggedOut.tMs + 'ms' : 'never shown'}`);
  console.log(`  first sample: ${JSON.stringify(samples[0])}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, `90-auth-hydration-${label}.json`),
    JSON.stringify({ label, samples, firstAuthMs: firstAuth?.tMs ?? null }, null, 2),
    'utf-8'
  );
  return { firstAuth, lastLoggedOut };
}

test('authenticated header on first paint: desktop vs mobile', async ({ browser }) => {
  test.skip(!fs.existsSync(STATE), '.auth-state.json not present - run npm run capture:auth first');

  for (const [label, opts] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    [
      'mobile',
      {
        viewport: { width: 393, height: 851 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      },
    ],
  ] as const) {
    const ctx = await browser.newContext({ ...opts, storageState: STATE });
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await measure(page, label);
    await ctx.close();
  }
});
