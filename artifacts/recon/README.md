# Evidence index

Raw captures behind every factual claim in `artifacts/bug-report.md`,
`ux-review.md` and `assertions.md`. Nothing here is part of the test suite — it is
the proof. Regenerate with `npm run recon`, or `npm run capture:auth` for the
authenticated set.

## Anonymous surface

| File | What it proves | Cited by |
|---|---|---|
| `01-landing.png`, `02-inventory.json`, `06-aria.txt` | The app ships `data-testid` on every control; no topic pills exist | locator strategy |
| `03-page.html` | Full DOM dump of the landing page | — |
| `13-pill-hunt.json` | A wide net over chip/pill/card/suggestion selectors finds only header buttons and footer links | BUG-1 |
| `14-hooks-before.json` + `19-hooks-after.json` | **Byte-identical.** No new test hook or live region appears after a reply — messages carry no `data-testid` | BUG-3, testability note |
| `15-send-button-states.json` | Send is disabled when empty, enabled when filled | test 6 |
| `17-streaming-timeline.json`, `53-inflight-poll.json` | Polled every 400ms through a full request: zero animated elements, constant SVG count, composer disabled + cleared | assertions.md, test 4 |
| `21-network-streams.json` | `/ask-unauthenticated` returns `application/json`, not `text/event-stream` — replies are atomic, not streamed | assertions.md |
| `50-suggestion-render-samples.json` | 20s / 10 samples: none of the 6 API titles appear in visible text, raw HTML, or script payloads | **BUG-1** |
| `70-clean-context-check.json`, `70-clean-context-landing.png` | Negative control for BUG-1: context logged as **0 cookies / 0 origins** with `Log in` visible, i.e. provably anonymous — and still 0/6 titles across 10 samples. Rules out "the suite saw the post-login UI" | **BUG-1** |
| `71-real-chrome-check.json`, `71-real-chrome-*.png` | Second negative control: **real headed Chrome**, fresh profile, stock desktop UA, at 1440×900 and 393×851 — still 0/6 titles, no "Suggested topics" label. Rules out headless/UA sniffing | **BUG-1** |
| `72-legal-surface.json` | Every visible link on the pre-login page with `href`, `target`, `rel` and resolved status. Shows all 7 return 200 with `rel="noopener noreferrer"`, and that the legacy `permission.io` legal URLs redirect to the identical `.ai` documents — a non-issue, not a bug | test 2 |
| `52-transcript-skeleton-before.txt`, `54-bubble-classes-after.json` | Message bubble DOM structure | locator design |
| `60-locator-comparison.json` | Three candidate message locators measured across a message lifecycle | ask-page.ts |
| `30-33-login-*` | Login page has clean testids; URL is `/login` | test 7 |
| `40-43-mobile-*` | No horizontal overflow at 393px; element boxes | test 8 |
| `81-recaptcha.json` | Login is gated by invisible reCAPTCHA v2 | **BUG-2** |
| `82-login-outcome.json` | Real credentials: submit disabled 20s+, zero auth requests, no console error, no user feedback | **BUG-2** |
| `90-auth-hydration-*.json` | The authenticated header never appears from saved `storageState` — this app's session is not restorable that way | open question in bug-report.md |

### Console-only reproductions (no artifact file)

| Script | What it demonstrates |
|---|---|
| `recon/session.spec.ts` | Gives the agent a codeword, then asks for it back. Prints both replies plus every request body, showing `sessionId: ""` on all of them and no history array → **BUG-4** |
| `recon/explore-authenticated.spec.ts` | The reCAPTCHA gate and the silent login dead-end → **BUG-2** |
| `recon/verify-pill-locator.spec.ts` | Proves test 2 is not vacuous. **Positive control:** injects the pill markup the app should render (built from the live API payload, wired to the real composer) and runs test 2's assertions unchanged — 6/6 detected, the click posts the topic's exact prompt, 200, one new bubble. **Negative control:** injects a chat bubble whose text is exactly a topic title — still 0 pills, closing the false positive that broke the first attempt. Mutates the page, so it lives here rather than in `tests/`. `npm run verify:pills` |
| `recon/verify-legal-surface.spec.ts` | The pre-login consent surface — binding language shown, 7 visible links all resolving after redirects, every `_blank` link carrying `rel="noopener"`. A suite test until the required pill coverage needed its slot; kept runnable here instead of deleted |

### BUG-1 evidence generator

`recon/verify-suggestions.spec.ts` (+ `recon/evidence.ts`) is the standalone proof of
BUG-1, alongside test 2 in the suite: it re-verifies the defect live and rewrites
`artifacts/bug-evidence/` — a full-page screenshot plus a self-contained note (the six
titles expected, `0/6` in visible text **and** raw HTML, `Log in` present with `0`
authenticated widgets as state proof, every control the page did render, verbatim API
payload). Run it with `npm run recon`.

## Authenticated surface — `authenticated/`

Captured human-in-the-loop after a manual login, on a real account holding 100 ASK.
The tool never clicks anything itself (the account has a wallet and a token
balance); the operator navigates and it records.

| File | What it proves |
|---|---|
| `desktop-redeem-*` | Only section is **"Past Offers"** — 8 of 8 expired, no active offers → **BUG-6** |
| `desktop-data-enrichment-hub-*` | The single live earning action: one 25 ASK survey → **BUG-6** |
| `desktop-wallet-*` | Withdrawal gated at 5,000 ASK ("collected 2%"); Withdraw button correctly `[disabled]`; contradictory 4,900 copy → **BUG-7** |
| `desktop-referrals-*` | Referrals pay 1,000 ASK — the only realistic route to the 5,000 gate |
| `desktop-00-landing-*` | Post-login chat; a `feedback-button` appears; still no suggestion pills |
| `mobile-*` | Same pages at 393px; no horizontal overflow |
| every `*-inventory.json` | Exactly 2 live regions per page, **both OneTrust's and both invisible** → **BUG-3** confirmed post-login |

Duplicate captures of the same page were removed. Credentials never appear in any
file here: an earlier ARIA snapshot that recorded a filled password field was
purged, and the capture tool no longer screenshots a filled login form.
