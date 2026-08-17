import { test, expect } from '../tests/fixtures/base';

/**
 * RETIRED SUITE TEST, kept runnable.
 *
 * This was a test in `tests/01-landing.spec.ts` until the two required
 * suggested-topic behaviours had to fit inside an 8-test budget. It lost its slot
 * to test 2, not its value - so it lives here, unchanged in substance, and can be
 * run any time or promoted back if a ninth slot ever exists:
 *
 *   npx playwright test --config=recon/recon.config.ts verify-legal-surface
 *
 * Why it mattered: the app puts binding language directly under the composer -
 * "By using Permission.ai, you agree to our Terms of Use ... you consent to the
 * collection, use, and disclosure of your information" - and holds the user to it
 * by typing, before any account exists. A dead Terms link on the page where consent
 * is obtained is a compliance exposure, and it is the kind of breakage nobody
 * notices, because nobody clicks their own footer. It is also the one risk class no
 * test in the suite can see: they all exercise the chat.
 *
 * Deterministic by construction - no LLM call anywhere in it.
 *
 * NOTE, and this is why the assertion follows redirects rather than checking
 * hostnames: the footer still points at the legacy permission.IO domain
 * (`permission.io/privacy-policy`, `www.permission.io/terms-of-use`) while the
 * consent sentence points at permission.AI. That looks like two sets of legal
 * documents on one page. It is not - both .io URLs 301 to the identical .ai
 * documents, verified byte-for-byte (159,572 B privacy, 155,974 B terms, same
 * <title> either way; artifacts/recon/72-legal-surface.json). So this is reported as
 * a non-issue rather than padded into the bug list, and the check asserts what
 * actually matters: the user reaches a real document.
 */
test('pre-login consent surface: binding language is shown and every legal link resolves', async ({
  askPage,
  page,
}) => {
  /* 1. The consent sentence is actually presented, not buried behind a click. */
  const consent = page.getByText(/By using Permission\.ai, you agree to our/i);
  await expect(
    consent,
    'The consent sentence is missing. Users are being held to terms the page never showed them.'
  ).toBeVisible();
  await expect(consent).toContainText(/Terms of Use/i);
  await expect(consent).toContainText(/Privacy Policy/i);

  /* 2. Inventory the links the APP renders. OneTrust's own subtree is excluded:
   * its cookie-policy links are the vendor's content, and asserting on them
   * would make this fail when a third party edits their consent widget. */
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .filter((a) => !a.closest('#onetrust-consent-sdk'))
      .filter((a) => !!(a as HTMLElement).offsetParent) // visible only
      .map((a) => ({
        text: (a.textContent ?? '').replace(/\s*\|\s*$/, '').trim(),
        href: (a as HTMLAnchorElement).href,
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel') ?? '',
      }))
      .filter((l) => l.text)
  );

  /* Guards the inventory itself: if a layout change drops the footer entirely,
   * every loop below would vacuously pass. Observed count is 7. */
  expect(
    links.length,
    `Expected the pre-login footer + consent links to be present, found ${links.length}. ` +
      `A vacuous pass here would hide a missing footer.`
  ).toBeGreaterThanOrEqual(7);

  /* The four documents the page is legally obliged to reach. */
  for (const required of ['Terms of Use', 'Privacy Policy', 'Support', 'Permission Home']) {
    expect(
      links.map((l) => l.text),
      `No visible "${required}" link on the pre-login page.`
    ).toContain(required);
  }

  /* 3. Every external link that opens a new tab carries rel="noopener".
   * Without it the opened page can reach window.opener and redirect this tab -
   * reverse tabnabbing. All 7 ship "noopener noreferrer" today, so this is a
   * regression guard on a security property that is easy to lose in a refactor. */
  for (const link of links) {
    if (link.target === '_blank') {
      expect(
        link.rel,
        `"${link.text}" -> ${link.href} opens in a new tab without rel="noopener" (reverse-tabnabbing risk).`
      ).toContain('noopener');
    }
  }

  /* 4. Every destination actually resolves. Redirects are followed on purpose
   * (see the note above), so the legacy .io links pass on the merits. Fetched
   * from the browser context so UA and cookies match a real visit, and in
   * parallel to keep this quick. */
  const results = await Promise.all(
    [...new Set(links.map((l) => l.href))].map(async (url) => {
      const res = await askPage.page.request
        .get(url, { maxRedirects: 5, timeout: 20_000 })
        .catch((e: Error) => e);
      return { url, outcome: res instanceof Error ? res.message.split('\n')[0] : res.status() };
    })
  );

  const broken = results.filter(
    (r) => typeof r.outcome !== 'number' || (r.outcome as number) >= 400
  );
  expect(
    broken,
    `Unreachable link(s) on the consent surface:\n${broken
      .map((b) => `  ${b.url} -> ${b.outcome}`)
      .join('\n')}`
  ).toEqual([]);
});
