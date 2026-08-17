import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Throwaway probe: what is actually assertable, green and deterministic on the
 * pre-login landing page that the current 8 tests do not already cover?
 *
 * Candidate: the consent/legal surface. The app puts binding language directly
 * under the composer ("you agree to our Terms of Use ... Privacy Policy"), so a
 * dead link there is a compliance exposure, not a cosmetic bug. Needs no LLM, so
 * it cannot flake on model latency.
 */
test('probe legal + entry-point links', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const reject = page.locator('#onetrust-reject-all-handler');
  try {
    await reject.waitFor({ state: 'visible', timeout: 12_000 });
    await reject.click();
  } catch {
    /* banner absent */
  }
  await page.waitForTimeout(2000);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .map((a) => ({
        text: (a.textContent ?? '').trim(),
        href: a.getAttribute('href'),
        resolved: (a as HTMLAnchorElement).href,
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        visible: !!(a as HTMLElement).offsetParent,
      }))
      .filter((l) => l.text)
  );

  const consentText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div,p,span')).find((e) =>
      /you agree to our/i.test(e.textContent ?? '')
    );
    return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
  });

  /* Status of every distinct destination, from the browser context so cookies
   * and UA match a real visit. */
  const statuses: Record<string, number | string> = {};
  for (const url of [...new Set(links.map((l) => l.resolved))]) {
    try {
      const res = await page.request.get(url, { maxRedirects: 5, timeout: 20_000 });
      statuses[url] = res.status();
    } catch (e) {
      statuses[url] = `ERROR: ${(e as Error).message.split('\n')[0]}`;
    }
  }

  const out = { checkedAt: new Date().toISOString(), consentText, links, statuses };
  fs.writeFileSync(
    path.join(__dirname, '..', 'artifacts', 'recon', '72-legal-surface.json'),
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
});
