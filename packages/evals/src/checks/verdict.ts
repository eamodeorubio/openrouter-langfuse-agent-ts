import { asSuccess, isBlank, lookupMade, type Success } from './run.js';

export interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

/** What promptfoo hands a check besides the output. The case declares its needs in `test.metadata`; `readCase` reads them. */
export interface CheckContext {
  test?: { metadata?: Record<string, unknown> };
}

/** The shape promptfoo calls: the output, then the test case. */
export type Check = (output: unknown, context?: unknown) => GradingResult;

const verdict = (pass: boolean, reason: string): GradingResult => ({
  pass,
  score: pass ? 1 : 0,
  reason,
});

export const pass = (reason: string): GradingResult => verdict(true, reason);
export const fail = (reason: string): GradingResult => verdict(false, reason);

/** The run the later checks judge: a success object with an answer and a lookup. */
export const judgeable = (output: unknown): Success | undefined => {
  const run = asSuccess(output);
  return run && !isBlank(run) && lookupMade(run) ? run : undefined;
};

/** The run a check that needs no lookup judges: a success object with an answer. */
export const answered = (output: unknown): Success | undefined => {
  const run = asSuccess(output);
  return run && !isBlank(run) ? run : undefined;
};
