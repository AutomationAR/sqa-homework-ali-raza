import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DOM discovery harness. NOT part of the test suite — this is the tool used to
 * replace guessed selectors with selectors that actually exist in the app.
 *
 * Run: npx playwright test --config=recon/recon.config.ts
 * Output: artifacts/recon/*.json + *.png
 */

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, name),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'utf-8'
  );
}

test('discover landing page structure', async ({ page }) => {
  const consoleErrors: string[] = [];
  const requests: { method: string; url: string }[] = [];

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!/\.(png|jpg|jpeg|svg|woff2?|css|ico|gif|webp)(\?|$)/i.test(u)) {
      requests.push({ method: r.method(), url: u });
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000); // let the SPA hydrate

  save('01-title-url.json', {
    title: await page.title(),
    url: page.url(),
  });

  await page.screenshot({ path: path.join(OUT, '01-landing.png'), fullPage: true });

  /* Every element carrying a test hook or a semantic role. This is what tells
   * us whether the app ships data-testid attributes at all. */
  const inventory = await page.evaluate(() => {
    const attrsOfInterest = [
      'data-testid',
      'data-test',
      'data-test-id',
      'data-cy',
      'data-qa',
      'aria-label',
      'role',
      'name',
      'placeholder',
      'type',
      'id',
    ];

    const describe = (el: Element) => {
      const rec: Record<string, string> = {
        tag: el.tagName.toLowerCase(),
      };
      for (const a of attrsOfInterest) {
        const v = el.getAttribute(a);
        if (v) rec[a] = v;
      }
      const cls = el.getAttribute('class');
      if (cls) rec.class = cls.slice(0, 160);
      const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (txt) rec.text = txt.slice(0, 120);
      const r = el.getBoundingClientRect();
      rec.box = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      return rec;
    };

    const out: Record<string, unknown> = {};

    out.testIdElements = Array.from(
      document.querySelectorAll('[data-testid],[data-test],[data-test-id],[data-cy],[data-qa]')
    ).map(describe);

    out.buttons = Array.from(document.querySelectorAll('button,[role="button"]')).map(describe);
    out.inputs = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).map(describe);
    out.links = Array.from(document.querySelectorAll('a')).map(describe);
    out.forms = Array.from(document.querySelectorAll('form')).map(describe);
    out.headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(describe);
    out.landmarks = Array.from(
      document.querySelectorAll('main,nav,header,footer,[role="main"],[role="navigation"],[role="log"],[role="status"],[aria-live]')
    ).map(describe);

    return out;
  });

  save('02-inventory.json', inventory);

  /* Trimmed HTML: enough to read structure, small enough to actually review. */
  const html = await page.content();
  save('03-page.html', html);

  save('04-network.json', requests.slice(0, 120));
  save('05-console-errors.json', consoleErrors);

  /* Playwright's own accessibility snapshot — the best guide to role-based
   * locators, which is what we want to build the suite on. */
  save('06-aria.txt', await page.locator('body').ariaSnapshot());

  console.log('=== TESTID ELEMENTS:', JSON.stringify(inventory.testIdElements).slice(0, 3000));
  console.log('=== INPUTS:', JSON.stringify(inventory.inputs).slice(0, 2000));
  console.log('=== BUTTONS:', JSON.stringify(inventory.buttons).slice(0, 4000));
});
