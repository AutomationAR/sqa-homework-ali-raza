import * as fs from 'fs';
import * as path from 'path';
import { type Page, type TestInfo } from '@playwright/test';

/**
 * Evidence capture for a defect that is reported but NOT asserted by the suite.
 *
 * BUG-1 (suggestions served by the API, rendered nowhere) cannot be written as a
 * green test - the product is broken, so the only passing versions of it would
 * assert something false. It is therefore documented in artifacts/bug-report.md,
 * and this regenerates its proof on demand via `npm run recon` so the write-up
 * never rests on a stale screenshot someone took by hand.
 *
 * Output goes to two places on purpose:
 *   1. testInfo.attach()  -> inline in the report of whichever run produced it.
 *   2. artifacts/bug-evidence/ -> stable filenames, so artifacts/bug-report.md
 *                            can cite them. NOT under artifacts/test-results/ or
 *                            artifacts/recon-results/, both gitignored and wiped.
 */

const EVIDENCE_DIR = path.join(__dirname, '..', 'artifacts', 'bug-evidence');

export interface AbsenceProbe {
  /** Label for the viewport this probe ran at. */
  viewport: string;
  /** Of the expected strings, which are in visible text / raw HTML at all. */
  foundInVisibleText: string[];
  foundInRawHtml: string[];
  /** Proof of which auth state produced this evidence. */
  state: { logInVisible: boolean; authenticatedWidgets: number };
  /** Every control the page DID render, so the absence is legible in context. */
  renderedControls: string[];
  screenshot: string;
}

async function probe(page: Page, expectedStrings: string[]): Promise<Omit<AbsenceProbe, 'viewport' | 'screenshot'>> {
  return page.evaluate((strings) => {
    const text = document.body.innerText;
    const html = document.documentElement.outerHTML;
    return {
      foundInVisibleText: strings.filter((s) => text.includes(s)),
      foundInRawHtml: strings.filter((s) => html.includes(s)),
      state: {
        logInVisible: !!document.querySelector('[data-testid="log-in-button"]'),
        authenticatedWidgets: document.querySelectorAll(
          '[data-testid="user-widget-button"],[data-testid="notification-widget-button"]'
        ).length,
      },
      renderedControls: Array.from(document.querySelectorAll('button,a'))
        .map((el) => (el.textContent ?? '').trim())
        .filter(Boolean),
    };
  }, expectedStrings);
}

/**
 * Screenshots the page at the viewport the test declared, probes it for content
 * that should be present, and attaches both to the report.
 *
 * Deliberately does NOT resize the page to take a second "mobile" shot. A
 * viewport resize inside a desktop context is not device emulation, and framing
 * it as mobile evidence would imply a small-screen layout defect that does not
 * exist - the mobile layout is fine, and test 8 asserts exactly that. Phone-width
 * evidence for BUG-1 comes from real device-width Chrome instead:
 * artifacts/recon/71-real-chrome-mobile-393x851.png.
 */
export async function captureAbsenceEvidence(
  page: Page,
  testInfo: TestInfo,
  opts: {
    /** e.g. 'BUG-1' - used as the filename stem. */
    bug: string;
    /** One line stating the defect, written into the evidence note. */
    claim: string;
    /** Strings the page is expected to render and does not. */
    expectedStrings: string[];
    /** Whatever the backend actually served, embedded verbatim as the other half of the contract. */
    apiEvidence?: unknown;
  }
): Promise<AbsenceProbe[]> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const size = page.viewportSize();
  const label = size ? `${size.width}x${size.height}` : 'default';
  /* The recon config declares no named project, so project.name is ''. Kept out
   * of the filename in that case rather than emitting a "bug-1--1440x900" stem. */
  const stem = [opts.bug.toLowerCase(), testInfo.project.name, label].filter(Boolean).join('-');

  const name = `${stem}.png`;
  const shot = await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage: true });
  await testInfo.attach(`${opts.bug} - page at ${label}`, { body: shot, contentType: 'image/png' });

  const probes: AbsenceProbe[] = [
    {
      viewport: [testInfo.project.name, label].filter(Boolean).join(' '),
      screenshot: `artifacts/bug-evidence/${name}`,
      ...(await probe(page, opts.expectedStrings)),
    },
  ];

  const note = [
    `# ${opts.bug} - captured evidence`,
    '',
    `**Claim:** ${opts.claim}`,
    '',
    `- Captured: ${new Date().toISOString()}`,
    `- Test: ${testInfo.titlePath.join(' > ')}`,
    `- Project: ${testInfo.project.name}`,
    `- URL: ${page.url()}`,
    '',
    '## Expected on the page',
    '',
    ...opts.expectedStrings.map((s) => `- \`${s}\``),
    '',
    '## Observed',
    '',
    '| viewport | in visible text | in raw HTML | `Log in` present | authenticated widgets | screenshot |',
    '|---|---|---|---|---|---|',
    ...probes.map(
      (p) =>
        `| ${p.viewport} | ${p.foundInVisibleText.length}/${opts.expectedStrings.length} | ` +
        `${p.foundInRawHtml.length}/${opts.expectedStrings.length} | ${p.state.logInVisible ? 'yes' : 'NO'} | ` +
        `${p.state.authenticatedWidgets} | \`${p.screenshot}\` |`
    ),
    '',
    'Raw HTML is checked as well as visible text: a 0 there means the markup was',
    'never rendered, not merely hidden by CSS. `Log in` present with zero',
    'authenticated widgets is the proof that this capture is the anonymous state.',
    '',
    '## Controls the page did render',
    '',
    ...probes.map((p) => `- **${p.viewport}**: ${p.renderedControls.map((c) => `\`${c}\``).join(', ')}`),
    '',
    ...(opts.apiEvidence
      ? ['## What the backend served', '', '```json', JSON.stringify(opts.apiEvidence, null, 2), '```', '']
      : []),
  ].join('\n');

  fs.writeFileSync(path.join(EVIDENCE_DIR, `${opts.bug.toLowerCase()}-evidence.md`), note);
  await testInfo.attach(`${opts.bug} - evidence note`, { body: note, contentType: 'text/markdown' });

  return probes;
}
