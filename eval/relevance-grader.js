/**
 * Relevance grader for Permission Agent replies.
 *
 * ONE implementation, THREE consumers:
 *   - eval/providers/relevance-provider.js  -> promptfoo custom provider
 *   - tests/03-ask.spec.ts                  -> live assertion, test 3
 *   - tests/02-suggested-topics.spec.ts     -> live assertion, test 2
 * so the rubric that grades the golden dataset is byte-for-byte the same rubric
 * that grades the real response coming off production. A second copy would
 * inevitably drift.
 *
 * TWO MODES:
 *   deterministic (default) - lexical relevance. No API key, no network, no
 *                             cost, no flake. Runs in CI and on a reviewer's
 *                             laptop with zero setup.
 *   llm (opt-in)            - LLM-as-judge rubric, enabled by setting
 *                             OPENAI_API_KEY or ANTHROPIC_API_KEY.
 *
 * Written in plain JS rather than TS on purpose: promptfoo loads provider files
 * directly at runtime, and a .js provider needs no transpiler in the loop. Types
 * for the TypeScript side live in relevance-grader.d.ts.
 */

'use strict';

const STOPWORDS = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'get', 'give',
  'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'more', 'my', 'of', 'on', 'or', 'so', 'some', 'tell', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'use', 'was',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'your',
]);

/**
 * Domain vocabulary for ask.permission.ai. A reply about earning that says
 * "ASK tokens", "rewards" or "offers" is on-topic even when it reuses none of
 * the asker's nouns, so these terms bridge the vocabulary gap that pure token
 * overlap would miss.
 */
const DOMAIN_TERMS = [
  'permission', 'ask', 'token', 'tokens', 'reward', 'rewards', 'earn', 'earning',
  'earnings', 'data', 'wallet', 'offer', 'offers', 'survey', 'surveys',
  'automation', 'automations', 'broker', 'privacy', 'consent', 'balance',
  'passive', 'ownership', 'share', 'sharing',
];

/** Phrases that mean the agent produced no usable answer. */
const NON_ANSWER_PATTERNS = [
  /\bi (?:do not|don't) know\b/i,
  /\bi (?:cannot|can't|am unable to) (?:help|assist|answer)\b/i,
  /\bno (?:information|data) (?:available|found)\b/i,
  /\bsomething went wrong\b/i,
  /\btry again later\b/i,
  /\ban error (?:has )?occurred\b/i,
  /\binternal server error\b/i,
  /\brate limit\b/i,
  /\bundefined\b/,
  /\bnull\b/,
  /\[object Object\]/,
];

/** Minimum characters before a reply counts as substantive. */
const MIN_SUBSTANTIVE_LENGTH = 40;

/** Lexical relevance score required to pass in deterministic mode. */
const RELEVANCE_THRESHOLD = 0.3;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Crude but predictable singular/plural fold so "token" matches "tokens". */
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function isLlmModeAvailable() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/**
 * Deterministic lexical grade.
 * @returns {{pass: boolean, score: number, reason: string, mode: string, signals: object}}
 */
function gradeDeterministic(question, answer) {
  const reply = String(answer == null ? '' : answer).trim();

  const signals = {
    length: reply.length,
    matchedKeywords: [],
    questionKeywords: [],
    domainTermHits: [],
    nonAnswerMatch: null,
  };

  if (reply.length === 0) {
    return { pass: false, score: 0, reason: 'Empty reply.', mode: 'deterministic', signals };
  }

  if (reply.length < MIN_SUBSTANTIVE_LENGTH) {
    return {
      pass: false,
      score: 0,
      reason: `Reply is ${reply.length} chars, under the ${MIN_SUBSTANTIVE_LENGTH}-char substantive floor.`,
      mode: 'deterministic',
      signals,
    };
  }

  const nonAnswer = NON_ANSWER_PATTERNS.find((re) => re.test(reply));
  if (nonAnswer) {
    signals.nonAnswerMatch = String(nonAnswer);
    return {
      pass: false,
      score: 0,
      reason: `Reply matches a non-answer/error pattern: ${nonAnswer}`,
      mode: 'deterministic',
      signals,
    };
  }

  const qWords = Array.from(new Set(tokenize(question).map(stem)));
  const aWords = new Set(tokenize(reply).map(stem));
  signals.questionKeywords = qWords;

  const matched = qWords.filter((w) => aWords.has(w));
  signals.matchedKeywords = matched;

  const overlap = qWords.length === 0 ? 0 : matched.length / qWords.length;

  const domainHits = DOMAIN_TERMS.map(stem).filter((t) => aWords.has(t));
  signals.domainTermHits = Array.from(new Set(domainHits));

  /* Overlap carries the decision; domain vocabulary can lift a reply that
   * answers the question in the product's own words. Capped so domain terms
   * alone can never manufacture a pass for an otherwise off-topic reply. */
  const domainBonus = Math.min(signals.domainTermHits.length * 0.05, 0.2);
  const score = Math.min(overlap + domainBonus, 1);

  const pass = score >= RELEVANCE_THRESHOLD;

  return {
    pass,
    score: Number(score.toFixed(3)),
    reason: pass
      ? `Relevant: ${matched.length}/${qWords.length} question keywords matched (${matched.join(', ') || 'none'}), ` +
        `${signals.domainTermHits.length} domain terms, score ${score.toFixed(2)} >= ${RELEVANCE_THRESHOLD}.`
      : `Off-topic: only ${matched.length}/${qWords.length} question keywords matched and ` +
        `${signals.domainTermHits.length} domain terms, score ${score.toFixed(2)} < ${RELEVANCE_THRESHOLD}.`,
    mode: 'deterministic',
    signals,
  };
}

const RUBRIC = [
  'You are grading whether an AI assistant reply is an acceptable answer.',
  '',
  'Fail the reply if ANY of these is true:',
  '  - it does not address what was asked',
  '  - it is an error message, a refusal, or "I don\'t know"',
  '  - it is empty or a single vague sentence with no information',
  '  - it contains raw placeholders such as undefined, null or [object Object]',
  '',
  'Otherwise pass it. Correct information phrased in different words than the',
  'question is still a pass - do not require keyword overlap.',
  '',
  'Reply ONLY with minified JSON: {"pass":boolean,"score":number,"reason":string}',
  'where score is 0..1 confidence that the reply is acceptable.',
].join('\n');

async function gradeWithLlm(question, answer) {
  const prompt = `${RUBRIC}\n\nQUESTION:\n${question}\n\nREPLY:\n${answer}`;

  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.EVAL_MODEL || 'claude-sonnet-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic grader HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return parseVerdict(body.content?.[0]?.text, 'llm:anthropic');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.EVAL_MODEL || 'gpt-4o-mini',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI grader HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return parseVerdict(body.choices?.[0]?.message?.content, 'llm:openai');
}

function parseVerdict(raw, mode) {
  const text = String(raw || '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Grader returned no JSON object: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  return {
    pass: Boolean(parsed.pass),
    score: typeof parsed.score === 'number' ? parsed.score : parsed.pass ? 1 : 0,
    reason: String(parsed.reason || ''),
    mode,
    signals: { rawVerdict: match[0] },
  };
}

/**
 * Grade a question/answer pair. Uses the LLM judge when a key is configured,
 * otherwise the deterministic grader.
 *
 * If the LLM call itself fails (network, quota, malformed output) we fall back
 * to the deterministic grade rather than failing the test. A grader outage is
 * not a defect in the application under test, and a suite that goes red because
 * a third-party judge rate-limited is a suite people learn to ignore.
 */
async function gradeRelevance(question, answer) {
  if (!isLlmModeAvailable()) return gradeDeterministic(question, answer);
  try {
    return await gradeWithLlm(question, answer);
  } catch (err) {
    const fallback = gradeDeterministic(question, answer);
    fallback.reason = `LLM grader unavailable (${err.message}); fell back to deterministic. ${fallback.reason}`;
    fallback.mode = 'deterministic-fallback';
    return fallback;
  }
}

module.exports = {
  gradeRelevance,
  gradeDeterministic,
  isLlmModeAvailable,
  MIN_SUBSTANTIVE_LENGTH,
  RELEVANCE_THRESHOLD,
};
