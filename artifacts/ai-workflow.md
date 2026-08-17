# AI workflow disclosure

## Tools

**Claude Code (Opus)** throughout, with **Playwright as the research tool**:
instead of asking a model which selectors the site uses, I had it write throwaway
scripts (`recon/`) dumping the real DOM, network and storage. Everything in
`tests/` rests on captured evidence.

## What AI got wrong, and how I caught it

**It invented the UI.** The draft targeted topic pills, a streaming indicator and
`a[href*="login"]`; recon showed no pills render (BUG-1), no streaming indicator
exists, and login is a `<button>`. Three of eight planned tests were fiction. It
also fabricated findings ("3x less likely to engage") and shipped a promptfoo
config that could not run.

**The mistake that mattered most:** the pill test's matcher could be satisfied by
the agent's own greeting — under `test.fail()`, that reports a live defect as
fixed. Caught by watching a headed run. The locator now demands an interactive
control whose whole label is the topic title, plus an ancestor check rejecting
chat bubbles, verified live in both directions.

**A prompt built on a false premise.** A later request asked me to fix "stale
authentication state" hiding six pills, and to assert all six visible. Both halves
were wrong: a fresh run logged 0 cookies / 0 origins with `Log in` visible and
still found 0/6 titles, repeated in headed Chrome (`bug-report.md`). A confident
prompt is a hypothesis; test it first.

## What I decided

- **Which 8 tests:** the unbuildable streaming test became the composer-lock
  contract; the consent surface lost its slot to pill coverage.
- **How to encode BUG-1:** both pill behaviours in one `test.fail()` test — green
  run, visible defect, and a fix breaks the annotation.
- **Waiting:** network + DOM + idle, layered. AI's instinct was to sleep.
- **Grader:** deterministic by default — no API key needed.
- **Where to stop:** login is captcha-gated; capture stays human-in-the-loop.
