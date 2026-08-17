import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { captureAbsenceEvidence } from './evidence';

/**
 * BUG-1 verification + evidence generator.
 *
 * Two jobs:
 *   1. Prove that in a DEFAULT (clean, anonymous) Playwright context the six
 *      unauthenticated suggestions served by the API render nowhere - including
 *      the negative control that the context really was anonymous.
 *   2. Regenerate artifacts/bug-evidence/ (screenshot + self-contained note) so
 *      the write-up in artifacts/bug-report.md always cites current proof.
 *
 * Lives in recon/ rather than tests/ because BUG-1 cannot be expressed as a
 * green test - the product is broken, and every passing version of that test
 * would have to assert something untrue. Run with `npm run recon`.
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

test('clean-context suggestion render check', async ({ page, context }, testInfo) => {
  const state = await context.storageState();
  const api = await page.request.get('/api/agent/suggestions-unauthenticated');
  const apiBody = await api.text();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const reject = page.locator('#onetrust-reject-all-handler');
  try {
    await reject.waitFor({ state: 'visible', timeout: 12_000 });
    await reject.click();
  } catch {
    /* banner absent */
  }

  const samples: unknown[] = [];
  for (let i = 0; i < 10; i++) {
    const sample = await page.evaluate((titles) => {
      const text = document.body.innerText;
      const html = document.documentElement.outerHTML;
      return {
        inVisibleText: titles.filter((t) => text.includes(t)),
        inRawHtml: titles.filter((t) => html.includes(t)),
        hasSuggestedTopicsLabel: /suggested\s*topics/i.test(text),
        hasDownloadExtension: /download extension/i.test(text),
        hasLogIn: /log in/i.test(text),
        controlNames: Array.from(document.querySelectorAll('button,a'))
          .map((el) => (el.textContent ?? '').trim())
          .filter(Boolean),
      };
    }, TITLES);
    samples.push({ atMs: i * 2000, ...sample });
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: path.join(OUT, '70-clean-context-landing.png'), fullPage: true });
  fs.writeFileSync(
    path.join(OUT, '70-clean-context-check.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        contextStorageState: { cookies: state.cookies.length, origins: state.origins.length },
        apiStatus: api.status(),
        apiBody: JSON.parse(apiBody),
        samples,
      },
      null,
      2
    )
  );

  /* Regenerate the citable evidence for artifacts/bug-report.md. */
  const enabled = (JSON.parse(apiBody) as Array<{ enabled: boolean; for_authenticated: boolean }>)
    .filter((s) => s.enabled && !s.for_authenticated);
  await captureAbsenceEvidence(page, testInfo, {
    bug: 'BUG-1',
    claim:
      'GET /api/agent/suggestions-unauthenticated serves enabled unauthenticated suggestions; ' +
      'the page renders none of them as selectable controls.',
    expectedStrings: TITLES,
    apiEvidence: enabled,
  });

  const last = samples[samples.length - 1] as { inVisibleText: string[] };
  console.log('VISIBLE TITLES AT 20s:', JSON.stringify(last.inVisibleText));
  expect(api.status()).toBe(200);
});
