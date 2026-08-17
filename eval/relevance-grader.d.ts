/** Type surface for the plain-JS grader, so the TypeScript suite stays typed. */

export interface RelevanceSignals {
  length?: number;
  matchedKeywords?: string[];
  questionKeywords?: string[];
  domainTermHits?: string[];
  nonAnswerMatch?: string | null;
  rawVerdict?: string;
}

export interface RelevanceVerdict {
  /** Whether the reply is an acceptable answer to the question. */
  pass: boolean;
  /** 0..1 confidence. */
  score: number;
  /** Human-readable justification, surfaced in test failure output. */
  reason: string;
  /** Which grader produced this verdict. */
  mode: 'deterministic' | 'deterministic-fallback' | 'llm:openai' | 'llm:anthropic';
  signals: RelevanceSignals;
}

export function gradeRelevance(question: string, answer: string): Promise<RelevanceVerdict>;
export function gradeDeterministic(question: string, answer: string): RelevanceVerdict;
export function isLlmModeAvailable(): boolean;
export const MIN_SUBSTANTIVE_LENGTH: number;
export const RELEVANCE_THRESHOLD: number;
