/**
 * Post-login capture tool (human-in-the-loop).
 *
 * WHY THIS EXISTS
 * The login form is gated by invisible reCAPTCHA v2, so an automated browser can
 * never complete it (see artifacts/bug-report.md BUG-2). Rather than attempt a
 * captcha bypass, this opens a REAL browser window, hands it to you for the
 * login, and then captures evidence from the authenticated session so the
 * post-signup half of artifacts/ux-review.md rests on observation instead of
 * imagination.
 *
 * WHY CAPTURE IS USER-DRIVEN
 * This account holds a wallet and an ASK balance. A script that clicked through
 * navigation on its own could hit "disconnect wallet", "log out", or something
 * transactional. So the script never clicks anything: you navigate, you press
 * Enter, it captures whatever is on screen. Read-only by construction.
 *
 * SESSION PORTABILITY — measured, not assumed:
 * This app's session does NOT restore from cookies + localStorage. Saving
 * `storageState` after a successful login and reapplying it produces a logged-OUT
 * header on both desktop and mobile (verified in recon/auth-hydration.spec.ts;
 * capture in artifacts/recon/90-auth-hydration-*.json). The access token is
 * evidently not held in either store.
 *
 * So the state file is saved for reference, but you should expect to log in again
 * for the mobile pass. The script prompts for it rather than pretending otherwise.
 *
 * RUN
 *   npm run capture:auth
 * optionally with the email pre-filled:
 *   PERMISSION_EMAIL=you@example.com npm run capture:auth
 *
 * Plain JavaScript on purpose: it needs interactive stdin, which the Playwright
 * test runner does not give us, and this way it runs under bare `node` with no
 * extra transpiler dependency.
 */

'use strict';

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE_URL = process.env.BASE_URL || 'https://ask.permission.ai';
const OUT = path.join(__dirname, '..', 'artifacts', 'recon', 'authenticated');
/* Contains session tokens - gitignored. Never commit this. */
const STATE_FILE = path.join(__dirname, '..', '.auth-state.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function slugFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname.replace(/^\/|\/$/g, '');
    return (p || 'home').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  } catch {
    return fallback;
  }
}

/** Everything worth having about the current page, without touching it. */
async function capture(page, label) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, label);

  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch((e) => {
    console.log(`   (full-page screenshot failed: ${e.message}; trying viewport only)`);
    return page.screenshot({ path: `${base}.png` });
  });

  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  fs.writeFileSync(`${base}-text.txt`, text, 'utf-8');

  /* Playwright's ARIA snapshot is the most useful accessibility view: it shows
   * the tree a screen reader would walk, and makes missing live regions obvious. */
  const aria = await page.locator('body').ariaSnapshot().catch(() => '(unavailable)');
  fs.writeFileSync(`${base}-aria.txt`, aria, 'utf-8');

  const inventory = await page
    .evaluate(() => {
      const describe = (el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          href: el.getAttribute('href') || undefined,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
          box: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          visible: r.width > 0 && r.height > 0,
        };
      };
      return {
        url: location.href,
        title: document.title,
        overflow: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          horizontallyScrolls:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
        },
        liveRegions: Array.from(
          document.querySelectorAll('[aria-live],[role="log"],[role="status"],[role="alert"]')
        ).map(describe),
        testids: Array.from(document.querySelectorAll('[data-testid]')).map(describe),
        buttons: Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(describe)
          .filter((b) => b.visible),
        links: Array.from(document.querySelectorAll('a')).map(describe).filter((l) => l.visible),
        messageBubbles: Array.from(
          document.querySelectorAll('div.rounded-lg[class*="fit-content"]')
        ).map(describe),
      };
    })
    .catch((e) => ({ error: e.message }));
  fs.writeFileSync(`${base}-inventory.json`, JSON.stringify(inventory, null, 2), 'utf-8');

  console.log(`   captured -> artifacts/recon/authenticated/${label}.{png,-text.txt,-aria.txt,-inventory.json}`);
  if (inventory && inventory.overflow) {
    console.log(
      `   url=${inventory.url}  horizontalScroll=${inventory.overflow.horizontallyScrolls}  liveRegions=${(inventory.liveRegions || []).length}  testids=${(inventory.testids || []).length}`
    );
  }
  return inventory;
}

async function interactiveLoop(page, prefix) {
  let n = 0;
  for (;;) {
    const answer = await ask(
      `\n[${prefix}] Navigate the app in the browser, then choose:\n` +
        `   ENTER = capture the page currently on screen\n` +
        `   n     = capture and give it a custom name\n` +
        `   d     = done with ${prefix}\n> `
    );

    if (answer.toLowerCase() === 'd') return;

    let label;
    if (answer.toLowerCase() === 'n') {
      const custom = await ask('   name for this capture: ');
      label = `${prefix}-${(custom || 'page').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    } else {
      n += 1;
      label = `${prefix}-${String(n).padStart(2, '0')}-${slugFromUrl(page.url(), 'page')}`;
    }
    await capture(page, label);
  }
}

async function main() {
  console.log('\n=== Post-login capture (read-only) ===');
  console.log('This script never clicks anything on its own. You drive; it records.\n');

  const browser = await chromium.launch({ headless: false });

  const reuse = fs.existsSync(STATE_FILE);
  if (reuse) {
    const answer = await ask(
      `Found a saved session at .auth-state.json. Reuse it and skip login? [Y/n] `
    );
    if (answer.toLowerCase() === 'n') fs.unlinkSync(STATE_FILE);
  }

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
  });
  const page = await desktop.newPage();

  if (!fs.existsSync(STATE_FILE)) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

    /* Dismiss the consent wall so it does not cover the form. */
    await page
      .locator('#onetrust-reject-all-handler')
      .click({ timeout: 12_000 })
      .catch(() => {});

    if (process.env.PERMISSION_EMAIL) {
      await page
        .getByTestId('login-email-input')
        .fill(process.env.PERMISSION_EMAIL)
        .catch(() => {});
      console.log('Email pre-filled from PERMISSION_EMAIL.');
    }

    console.log('\n--> In the browser window: enter your password, solve the captcha, log in.');
    console.log('    (Password is deliberately NOT automated - type it yourself.)');
    await ask('\nPress ENTER here once you are logged in... ');

    if (page.url().includes('/login')) {
      console.log(`WARNING: still on ${page.url()} - captures may show the logged-out view.`);
    }

    await desktop.storageState({ path: STATE_FILE });
    console.log('Session saved to .auth-state.json (gitignored) for reference.');
    console.log('NOTE: this app does not restore sessions from storage state - expect');
    console.log('      to log in again for the mobile pass.');
  } else {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#onetrust-reject-all-handler').click({ timeout: 8_000 }).catch(() => {});
    console.log('Reusing saved session.');
  }

  await page.waitForTimeout(2500);
  await capture(page, 'desktop-00-landing');
  await interactiveLoop(page, 'desktop');

  /* --- Mobile viewport --- */
  console.log('\n=== Mobile viewport (Pixel 5) ===');
  const mobile = await browser.newContext({
    ...devices['Pixel 5'],
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
  });
  const mpage = await mobile.newPage();
  await mpage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await mpage.locator('#onetrust-reject-all-handler').click({ timeout: 10_000 }).catch(() => {});
  await mpage.waitForTimeout(2500);

  /* Check rather than assume - the storage state usually will NOT carry the
   * session, and capturing a logged-out mobile view while believing it is
   * authenticated is exactly how a bogus "hydration bug" gets reported. */
  const mobileAuthed = await mpage
    .locator('[data-testid="user-widget-button"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!mobileAuthed) {
    console.log('\n--> Mobile is NOT logged in (expected). Log in in the browser window,');
    console.log('    then press ENTER here. Skip with "s" to capture the anonymous mobile view.');
    const a = await ask('> ');
    if (a.toLowerCase() !== 's') {
      await mpage.waitForTimeout(1500);
      await mobile.storageState({ path: STATE_FILE }).catch(() => {});
    }
  } else {
    console.log('Mobile session carried over.');
  }

  await capture(mpage, 'mobile-00-landing');
  await interactiveLoop(mpage, 'mobile');

  await browser.close();
  console.log(`\nDone. Evidence in artifacts/recon/authenticated/`);
  console.log('Delete .auth-state.json when finished - it contains live session tokens.');
}

main().catch((err) => {
  console.error('\nCapture failed:', err);
  process.exit(1);
});
