# SQA Homework — ask.permission.ai

Playwright + TypeScript suite against the Permission Agent pre-login chat. Its relevance assertion (`eval/relevance-grader.js`) is the same rubric Promptfoo evaluates, so live tests and the LLM eval never drift.

## Setup

```bash
npm install
npx playwright install chromium     # or: npm run setup
```

**No credentials, API keys, or `.env` file required.**

## Run

### Headless (default)

```bash
npm test                    # all 8 tests, headless, 3 workers (~1.2 min)
npm run test:desktop        # the 7 desktop tests only (1440x900)
npm run test:mobile         # the 1 mobile test only (Pixel 5)
npm run eval                # promptfoo relevance suite (8 cases)
npm run test:report         # open the HTML report
```

`headless` is unset in `playwright.config.ts`, so Playwright's default applies: headless, slow-mo off.

### Headed (visible browser)

```bash
npm run test:headed              # all 8, visible, one at a time (~2.5 min)
npm run test:headed:desktop      # the 7 desktop tests, visible
npm run test:headed:mobile       # the 1 mobile test, visible (Pixel 5 window)
npm run test:ui                  # Playwright UI mode: pick tests, time-travel, watch
```

Headed runs force `--workers=1`. Slow-mo auto-enables at 250ms; override with `SLOWMO=600` or `SLOWMO=0`.

**What you'll see:** cookie dialog dismissed → greeting → question typed → composer locks → Pixel 5 last.

### Also available

```bash
npm run recon           # DOM / network / storage discovery
npm run capture:auth    # post-login capture (manual login)
npm run verify:pills    # positive + negative controls behind test 2
```

## Expected output

```text
8 passed (1.2m)          # npm test      — headless, 3 workers  (exit 0)
8 passed (2.5m)          # test:headed   — visible, 1 worker    (exit 0)
✓ 8 passed (100%)        # npm run eval  — no API key needed
```

Seven pass outright. Test 2 is annotated `test.fail()` against **BUG-1** — six anonymous topics served, none rendered (`artifacts/bug-report.md`) — so the run stays green with the defect visible. ✘ means **expected failure**: it turns red the moment the pills render.

## Anonymous by construction

All 8 tests assert the pre-login experience, **enforced rather than assumed**. `playwright.config.ts` pins `storageState: { cookies: [], origins: [] }`; the `askPage` fixture then checks twice per test (`tests/helpers/state-check.ts`) — empty context before navigation, unauthenticated UI after (`log-in-button` present, `user-widget-button` absent). A leak fails with *"Test context is not clean"*, not a phantom product bug.

## Test Strategy (TL;DR)

**Covered:** initial render, topic pills (click + reply), free-text submission, composer lock, Shift+Enter, empty input, login navigation, mobile layout. **Skipped:** post-login automation (reCAPTCHA; reviewed by hand), consent surface (moved to recon), visual regression. **Why:** the four required behaviours map to tests 2, 3 and 5; the rest catch failure modes seen during recon.

| # | Test | Catches |
|---|------|---------|
| 1 | Composer + agent identity render | Broken first load |
| 2 | Pills render, click returns reply (`test.fail()`, BUG-1) | Lost onboarding |
| 3 | Free-text question returns substantive reply | Core path, relevance |
| 4 | Composer locks in flight; one submit, one POST | Double-submit |
| 5 | Shift+Enter newlines, does not submit | Keyboard contract |
| 6 | Empty/whitespace rejected on both paths | Unvalidated Enter |
| 7 | Log in reaches a usable form | Navigation, readiness |
| 8 | Mobile: no overflow, reachable targets | Small-screen regressions |

Tests 2 and 3 read expectations from `/api/agent/suggestions-unauthenticated` at runtime, so CMS changes don't make them stale.

## Key Decisions

**Recon before code** — DOM, network and storage dumped first. No pills and no streaming indicator killed three planned tests and reshaped the suite.

**Locators** — `data-testid` throughout. Bubbles ship none, so `recon/explore-bubbles.spec.ts` measured three candidates and picked `div.rounded-lg[class*="fit-content"]`.

**Waiting on AI** — layered signals: POST 200, bubble count increments, composer re-enables. 30s ceiling, no sleeps. See `artifacts/assertions.md`.

**Known-failing test** — `test.fail()` fails when the test *passes*, so a fix forces the annotation off. `verify:pills` proves it isn't vacuous.

**Budget trade-off** — the consent/legal surface moved to recon (`verify-legal-surface`), freeing a slot for pill coverage.

**Scope stops at login** — invisible reCAPTCHA blocks automation by design. Documented, not worked around.

## AI Disclosure

See `artifacts/ai-workflow.md` for tools used, what was AI-generated vs. corrected, and one AI mistake I caught.

## Next Steps

- CI on a schedule, not per-push — hits a live LLM
- Post-signup coverage once captcha-exempt credentials exist
- Grow the golden dataset from production replies
- Visual regression once layout stabilises

## Submission Checklist

- ☑ Repo named `sqa-homework-ali-raza`, default branch `main`
- ☑ README ≤ 500 words (excluding commands/checkboxes)
- ☑ Max 8 tests; all 4 required behaviours covered
- ☑ `artifacts/assertions.md` (≤ 300 words)
- ☑ LLM eval wired (Promptfoo, no API key needed)
- ☑ `artifacts/ux-review.md` (≤ 400 words, desktop + mobile, post-signup)
- ☑ `artifacts/data-checks.md` (≤ 300 words + SQL)
- ☑ `artifacts/ai-workflow.md` (≤ 300 words, all 4 questions)
- ☑ `artifacts/report/` included
- ☑ `artifacts/demo.mp4` (60–90 sec)
- ☑ Commit history shows evolution
