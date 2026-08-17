import { test } from '@playwright/test';

/** Decisive check for conversation memory across turns. */
test('does the agent retain context across turns?', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/agent/ask') && r.method()==='POST') posts.push(r.postData() ?? ''); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.locator('#onetrust-reject-all-handler').click().catch(()=>{});
  await page.waitForTimeout(1000);
  const input = page.getByTestId('agent-chat-input');
  const send = page.getByTestId('agent-chat-input-send-button');
  const bubbles = page.locator('div.rounded-lg[class*="fit-content"]');
  const ask = async (q: string) => {
    const before = await bubbles.count();
    await input.fill(q);
    await send.click();
    await page.waitForFunction((n) => document.querySelectorAll('div.rounded-lg[class*="fit-content"]').length > n, before, { timeout: 40000 });
    await page.waitForTimeout(800);
    const ps = await bubbles.last().locator('p.leading-relaxed').allInnerTexts();
    console.log(`Q: ${q}\nA: ${ps.join(' ').slice(0, 260)}\n`);
  };
  await ask('Remember this codeword: ZEBRA42. Just confirm you got it.');
  await ask('What was the codeword I just gave you?');
  console.log('--- REQUEST BODIES (note sessionId + absence of history) ---');
  posts.forEach((p,i)=>console.log(`  [${i}] ${p.slice(0,200)}`));
});
