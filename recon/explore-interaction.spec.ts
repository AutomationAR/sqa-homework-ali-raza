import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 2 recon: what does the DOM look like DURING and AFTER a real response?
 * This is what determines the waiting strategy, so it has to be observed rather
 * than assumed.
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

/** Snapshot every element with a test hook, plus anything that looks like a
 *  live region / loading affordance. */
async function hooks(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const list = Array.from(
      document.querySelectorAll(
        '[data-testid],[aria-live],[role="status"],[role="log"],[aria-busy],svg[class*="animate"],[class*="animate-"]'
      )
    );
    return list.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid') ?? undefined,
        ariaLive: el.getAttribute('aria-live') ?? undefined,
        role: el.getAttribute('role') ?? undefined,
        ariaBusy: el.getAttribute('aria-busy') ?? undefined,
        cls: (el.getAttribute('class') ?? '').slice(0, 120) || undefined,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
        visible: r.width > 0 && r.height > 0,
      };
    });
  });
}

test('interaction + streaming DOM', async ({ page }) => {
  const sse: string[] = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] ?? '';
    if (/event-stream|json/.test(ct) && !/\.js|\.css/.test(r.url())) {
      sse.push(`${r.status()} ${r.request().method()} ${r.url()} [${ct}]`);
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  /* ---- Cookie banner: does dismissing it reveal anything new? ---- */
  const acceptBtn = page.locator('#onetrust-accept-btn-handler');
  const bannerWasVisible = await acceptBtn.isVisible().catch(() => false);
  if (bannerWasVisible) {
    await acceptBtn.click();
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(OUT, '10-after-cookie-accept.png'), fullPage: true });
  save('11-banner-state.json', { bannerWasVisible });
  save('12-aria-after-cookies.txt', await page.locator('body').ariaSnapshot());

  /* ---- Is there ANY clickable pill/chip/suggestion? Cast a wide net. ---- */
  const pillHunt = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button,a,li,[role="button"],[class*="chip"],[class*="pill"],[class*="badge"],[class*="suggest"],[class*="topic"],[class*="prompt"],[class*="card"]'));
    return candidates
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') ?? undefined,
          cls: (el.getAttribute('class') ?? '').slice(0, 100) || undefined,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          visible: r.width > 0 && r.height > 0,
        };
      })
      .filter((c) => c.visible && c.text.length > 0);
  });
  save('13-pill-hunt.json', pillHunt);
  console.log('=== PILL HUNT ===', JSON.stringify(pillHunt, null, 1).slice(0, 2500));

  /* ---- Baseline hooks before sending ---- */
  const before = await hooks(page);
  save('14-hooks-before.json', before);
  console.log('=== HOOKS BEFORE ===', JSON.stringify(before).slice(0, 2500));

  /* ---- Send button state with empty vs filled input ---- */
  const input = page.getByTestId('agent-chat-input');
  const send = page.getByTestId('agent-chat-input-send-button');
  const emptyDisabled = await send.isDisabled();
  await input.fill('What is Permission.ai and how do I earn rewards?');
  await page.waitForTimeout(400);
  const filledDisabled = await send.isDisabled();
  save('15-send-button-states.json', { emptyDisabled, filledDisabled });
  console.log('=== SEND STATES === empty disabled:', emptyDisabled, '| filled disabled:', filledDisabled);

  /* ---- Fire it, then poll the DOM rapidly to catch the streaming state ---- */
  await send.click();

  const timeline: unknown[] = [];
  for (let i = 0; i < 24; i++) {
    timeline.push({ tMs: i * 750, hooks: await hooks(page) });
    if (i === 1) await page.screenshot({ path: path.join(OUT, '16-streaming.png') });
    await page.waitForTimeout(750);
  }
  save('17-streaming-timeline.json', timeline);

  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '18-after-response.png'), fullPage: true });
  const after = await hooks(page);
  save('19-hooks-after.json', after);
  console.log('=== HOOKS AFTER ===', JSON.stringify(after).slice(0, 3000));
  save('20-aria-after-response.txt', await page.locator('body').ariaSnapshot());
  save('21-network-streams.json', sse);
  console.log('=== STREAM ENDPOINTS ===', JSON.stringify(sse.slice(0, 25), null, 1));
});

test('login page structure', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('#onetrust-accept-btn-handler').click().catch(() => {});
  await page.waitForTimeout(1500);

  await page.getByTestId('log-in-button').click();
  await page.waitForTimeout(5000);

  save('30-login-url.json', { url: page.url(), title: await page.title() });
  await page.screenshot({ path: path.join(OUT, '31-login.png'), fullPage: true });
  save('32-login-aria.txt', await page.locator('body').ariaSnapshot());

  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,button,[data-testid]')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid') ?? undefined,
      type: el.getAttribute('type') ?? undefined,
      name: el.getAttribute('name') ?? undefined,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || undefined,
    }))
  );
  save('33-login-fields.json', fields);
  console.log('=== LOGIN URL ===', page.url());
  console.log('=== LOGIN FIELDS ===', JSON.stringify(fields).slice(0, 2500));
});

test('mobile layout', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 851 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, '40-mobile-with-banner.png'), fullPage: true });
  await page.locator('#onetrust-accept-btn-handler').click().catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '41-mobile.png'), fullPage: true });
  save('42-mobile-aria.txt', await page.locator('body').ariaSnapshot());

  const boxes = await page.evaluate(() => {
    const ids = ['agent-chat-input', 'agent-chat-input-send-button', 'log-in-button', 'sign-up-button', 'ai-page-title'];
    const out: Record<string, unknown> = { docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth };
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const r = el.getBoundingClientRect();
      out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  });
  save('43-mobile-boxes.json', boxes);
  console.log('=== MOBILE BOXES ===', JSON.stringify(boxes, null, 1));
  await ctx.close();
});
