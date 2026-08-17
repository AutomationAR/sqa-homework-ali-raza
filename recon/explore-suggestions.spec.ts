import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');

function save(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, name),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'utf-8'
  );
}

const TITLES = [
  'What is Permission',
  'Best way to earn ASK',
  'How permission uses my data',
  'What is passive earning',
  'What is data ownership',
  'Permission Wallet',
];

/**
 * Settles definitively whether the suggestions returned by
 * /api/agent/suggestions-unauthenticated are ever rendered in the DOM.
 * Searches ALL nodes including hidden/zero-size ones, over a 20s window.
 */
test('are API suggestions ever rendered?', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let apiPayload: unknown = null;
  page.on('response', async (r) => {
    if (r.url().includes('/api/agent/suggestions')) {
      apiPayload = await r.json().catch(() => null);
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const samples: unknown[] = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2000);
    samples.push(
      await page.evaluate((titles) => {
        const bodyText = document.body.innerText ?? '';
        const allHtml = document.documentElement.outerHTML;
        return {
          tMs: undefined,
          // Does the visible text contain any suggestion title?
          inVisibleText: titles.filter((t) => bodyText.includes(t)),
          // Does the raw HTML contain it anywhere (hidden, display:none, etc.)?
          inRawHtml: titles.filter((t) => allHtml.includes(t)),
          // Is it anywhere in the React props / JSON payloads embedded in scripts?
          inScripts: titles.filter((t) =>
            Array.from(document.querySelectorAll('script')).some((s) => (s.textContent ?? '').includes(t))
          ),
        };
      }, TITLES)
    );
  }

  save('50-suggestion-render-samples.json', { apiPayload, samples });
  await page.screenshot({ path: path.join(OUT, '51-fresh-20s.png'), fullPage: true });

  console.log('=== API RETURNED COUNT ===', Array.isArray(apiPayload) ? apiPayload.length : 'n/a');
  console.log('=== RENDER SAMPLES ===', JSON.stringify(samples, null, 1));

  await ctx.close();
});

/** Capture the chat transcript DOM structure so message locators can be built
 *  on something real, and identify any in-flight loading affordance. */
test('message container structure + loading affordance', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.locator('#onetrust-accept-btn-handler').click().catch(() => {});
  await page.waitForTimeout(1500);

  /* Structure of the transcript BEFORE sending (greeting only). */
  const greetingStructure = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="agent-chat-input"]');
    // Walk up to find the common scroll container, then dump its skeleton.
    let node: Element | null = input;
    for (let i = 0; i < 6 && node?.parentElement; i++) node = node.parentElement;
    const skeleton = (el: Element, depth = 0): string => {
      if (depth > 5) return '';
      const cls = (el.getAttribute('class') ?? '').slice(0, 90);
      const tid = el.getAttribute('data-testid');
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .slice(0, 60);
      let s = `${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${tid ? ` data-testid="${tid}"` : ''} class="${cls}">${own}\n`;
      for (const c of Array.from(el.children)) s += skeleton(c, depth + 1);
      return s;
    };
    return node ? skeleton(node) : 'not found';
  });
  save('52-transcript-skeleton-before.txt', greetingStructure);

  const input = page.getByTestId('agent-chat-input');
  await input.fill('How can I earn ASK tokens?');
  await page.getByTestId('agent-chat-input-send-button').click();

  /* Poll fast for the first 8s to catch any transient loading UI. */
  const inflight: unknown[] = [];
  for (let i = 0; i < 20; i++) {
    inflight.push(
      await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('p')).map((p) => ({
          cls: (p.getAttribute('class') ?? '').slice(0, 80),
          text: (p.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
        }));
        const send = document.querySelector('[data-testid="agent-chat-input-send-button"]') as HTMLButtonElement | null;
        const ta = document.querySelector('[data-testid="agent-chat-input"]') as HTMLTextAreaElement | null;
        return {
          paragraphCount: bubbles.length,
          bubbles: bubbles.slice(-4),
          sendDisabled: send?.disabled,
          inputDisabled: ta?.disabled,
          inputValue: ta?.value,
          svgCount: document.querySelectorAll('svg').length,
          animatedEls: Array.from(document.querySelectorAll('[class*="animate"],[class*="pulse"],[class*="spin"],[class*="bounce"],[class*="dot"]')).map((e) => (e.getAttribute('class') ?? '').slice(0, 70)),
        };
      })
    );
    await page.waitForTimeout(400);
  }
  save('53-inflight-poll.json', inflight);
  console.log('=== IN-FLIGHT (first 8 samples) ===', JSON.stringify(inflight.slice(0, 8), null, 1));

  await page.waitForTimeout(6000);
  const afterStructure = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    return ps.map((p) => {
      // climb to the bubble wrapper to learn how user vs agent is distinguished
      const wrap = p.parentElement;
      const outer = wrap?.parentElement;
      return {
        pClass: (p.getAttribute('class') ?? '').slice(0, 80),
        wrapClass: (wrap?.getAttribute('class') ?? '').slice(0, 120),
        outerClass: (outer?.getAttribute('class') ?? '').slice(0, 120),
        text: (p.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      };
    });
  });
  save('54-bubble-classes-after.json', afterStructure);
  console.log('=== BUBBLE CLASSES ===', JSON.stringify(afterStructure, null, 1).slice(0, 4000));
});
