import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, '..', 'artifacts', 'recon');

/**
 * Establishes the message locator used by the suite.
 *
 * Two questions had to be answered before any "did a reply arrive?" logic could
 * be written:
 *   1. Which locator yields exactly ONE node per agent message, even when the
 *      reply contains several paragraphs?
 *   2. Which locator ignores the echo of the user's own message, which the app
 *      appends the instant you hit send?
 *
 * A locator that gets either wrong produces a suite that passes for the wrong
 * reason. The first version of this suite used p.leading-relaxed and went red on
 * a two-paragraph reply - that failure is what prompted this comparison.
 */
test('compare candidate message locators across a message lifecycle', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.locator('#onetrust-reject-all-handler').click().catch(() => {});
  await page.waitForTimeout(1200);

  const snapshot = async (phase: string) => {
    const data = await page.evaluate(() => {
      const count = (s: string) => document.querySelectorAll(s).length;
      const texts = (s: string) =>
        Array.from(document.querySelectorAll(s)).map((e) =>
          (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 55)
        );
      return {
        counts: {
          'p.leading-relaxed': count('p.leading-relaxed'),
          'div.text-md.leading-relaxed': count('div.text-md.leading-relaxed'),
          'div.rounded-lg[class*="fit-content"]': count('div.rounded-lg[class*="fit-content"]'),
        },
        bubbleTexts: texts('div.rounded-lg[class*="fit-content"]'),
        wrapperTexts: texts('div.text-md.leading-relaxed'),
      };
    });
    console.log(`=== ${phase} ===`, JSON.stringify(data.counts));
    return { phase, ...data };
  };

  const results = [];
  results.push(await snapshot('BEFORE (greeting only)'));

  /* A prompt worded to provoke a multi-paragraph reply, which is what broke the
   * paragraph-counting locator. */
  await page.getByTestId('agent-chat-input').fill(
    'List three ways I can earn ASK tokens, with a short explanation for each.'
  );
  await page.getByTestId('agent-chat-input-send-button').click();

  await page.waitForTimeout(1200);
  results.push(await snapshot('DURING (user bubble rendered, no reply yet)'));

  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-testid="agent-chat-input"]') as HTMLTextAreaElement | null;
      return ta && !ta.disabled;
    },
    { timeout: 40_000 }
  );
  await page.waitForTimeout(2000);
  results.push(await snapshot('AFTER (reply rendered)'));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '60-locator-comparison.json'), JSON.stringify(results, null, 2), 'utf-8');

  /* Expected outcome, and the reason the suite uses the third locator:
   *   p.leading-relaxed                     1 -> 1 -> 2 or 3  counts PARAGRAPHS,
   *                                                           so the final value
   *                                                           depends on how much
   *                                                           prose the model wrote
   *   div.text-md.leading-relaxed           1 -> 2 -> 3       counts the user echo,
   *                                                           i.e. false positive
   *   div.rounded-lg[class*="fit-content"]  1 -> 1 -> 2       correct
   *
   * Row one is non-deterministic by nature - that is the point. If this run's reply
   * is single-paragraph you will see 2; a multi-paragraph reply gives 3. A locator
   * whose expected count depends on the model's writing style cannot be asserted on.
   */
  console.log('\nSUMMARY');
  for (const r of results) console.log(`  ${r.phase}: ${JSON.stringify(r.counts)}`);
});
