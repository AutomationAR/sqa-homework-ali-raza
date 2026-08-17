# Assertion strategy for non-deterministic replies

Every reply is a fresh completion, greeting included: three loads, three
different greetings. No reply text is assertable.

## Three layers asserted

1. **Network** — the `/ask` POST returns 200, so a backend failure reports as one,
   not a mystery timeout.
2. **DOM** — the agent-bubble count increments by exactly one, so a 200 that
   renders nothing still fails.
3. **Semantic** — `eval/relevance-grader.js` grades it: non-empty, past a
   40-character floor, free of error/refusal/`undefined` patterns, on-topic.

Plus the busy contract: composer disabled and cleared in flight, re-enabled after;
one submit, one request.

## Not asserted, deliberately

- **Exact text or keywords** — "What is Permission?" can be answered without the
  word "Permission".
- **Length** beyond the floor; **greeting wording**, generated per load.
- **Latency** — logged, never gated.
- **A streaming indicator.** Twenty polls at 400ms found zero animated elements
  and a constant SVG count; there is none to assert.

## The opposite problem (test 2)

The pills never render, so the risk is a false **pass**. The expectation comes
from the app's own API; the match is anchored to an interactive element's whole
label — a substring matcher once scored the agent's greeting as a pill, reporting
the defect as fixed — and an ancestor check rejects chat bubbles. The report
separates "hidden by CSS" from "never rendered": it is the second, so BUG-1 is
data-handling. `recon/verify-pill-locator.spec.ts` proves both directions live.

## LLM-evaluation wiring

One rubric, three callers: promptfoo's 8 cases plus live assertions in tests 3 and
2. Deterministic and lexical by default — no key, no network. An API key switches
it to an LLM judge, which falls back rather than failing: a grader outage is not
an app defect.

**Known limit:** the lexical grader rejects a correct answer that shares no
vocabulary with the question.
