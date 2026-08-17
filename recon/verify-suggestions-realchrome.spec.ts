import { test, expect, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Control for the previous check: is the missing-pills result an artefact of
 * headless automation (UA sniffing / bot detection) rather than a product bug?
 *
 * Launches REAL Chrome, headed, fresh profile - i.e. as close to a human
 * incognito window as automation gets - and looks for the same six titles.
 */
const TITLES = [
  'What is Permission',
  'Best way to earn ASK',
  'How permission uses my data',
  'What is passive earning',
  'What is data ownership',
  'Permission Wallet',
];

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');
const BASE = process.env.BASE_URL ?? 'https://ask.permission.ai';

test('real headed Chrome, fresh profile: are the pills there?', async () => {
  const results: Record<string, unknown> = {};

  for (const [label, opts] of [
    ['desktop-1440x900', { viewport: { width: 1440, height: 900 } }],
    ['mobile-393x851', { viewport: { width: 393, height: 851 } }],
  ] as const) {
    const browser = await chromium.launch({ channel: 'chrome', headless: false });
    const context = await browser.newContext(opts);
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const reject = page.locator('#onetrust-reject-all-handler');
    try {
      await reject.waitFor({ state: 'visible', timeout: 12_000 });
      await reject.click();
    } catch {
      /* banner absent */
    }
    await page.waitForTimeout(15_000);

    results[label] = await page.evaluate((titles) => {
      const text = document.body.innerText;
      const html = document.documentElement.outerHTML;
      return {
        userAgent: navigator.userAgent,
        webdriver: navigator.webdriver,
        inVisibleText: titles.filter((t) => text.includes(t)),
        inRawHtml: titles.filter((t) => html.includes(t)),
        hasSuggestedTopicsLabel: /suggested\s*topics/i.test(text),
        hasDownloadExtension: /download extension/i.test(text),
        hasLogIn: /log in/i.test(text),
      };
    }, TITLES);

    await page.screenshot({ path: path.join(OUT, `71-real-chrome-${label}.png`), fullPage: true });
    await browser.close();
  }

  fs.writeFileSync(
    path.join(OUT, '71-real-chrome-check.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), base: BASE, results }, null, 2)
  );
  console.log(JSON.stringify(results, null, 2));
  expect(Object.keys(results)).toHaveLength(2);
});
