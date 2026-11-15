/** Builders for records shaped like the `results.json` that promptfoo writes. */

export interface RunSpec {
  model?: string;
  caseName?: string;
  /** The run ended in a provider error. */
  error?: boolean;
  /** Metrics of checks that failed, so the run did not pass. */
  failed?: string[];
  /** Metrics of checks that ran and passed. */
  checks?: string[];
  /** The cost the CLI reported. Absent means none was reported. */
  cost?: number;
  /** `null` leaves the latency out of the record. */
  latencyMs?: number | null;
  /** The `round` of each tool call. */
  rounds?: number[];
  /** Judge scores by metric, such as `judge-relevance`. */
  judge?: Record<string, number>;
  /** The threshold of each judge rubric, as the assertion states it. 0.7 for a rubric left out. */
  thresholds?: Record<string, number>;
  /** Rubrics Jev did not answer, by metric, with the reason promptfoo recorded. Promptfoo records a score of 0 for them. */
  unanswered?: Record<string, string>;
}

export const run = (spec: RunSpec = {}) => {
  const {
    model = 'm/one',
    caseName = 'A1',
    error = false,
    failed = [],
    checks = [],
    cost,
    latencyMs = 100,
    rounds = [],
    judge = {},
    thresholds = {},
    unanswered = {},
  } = spec;
  const passed = !error && failed.length === 0;
  const components = [
    ...failed.map((metric) => ({
      pass: false,
      score: 0,
      assertion: { type: 'javascript', metric },
    })),
    ...checks.map((metric) => ({
      pass: true,
      score: 1,
      assertion: { type: 'javascript', metric },
    })),
    ...Object.entries(judge).map(([metric, score]) => ({
      // Promptfoo records a weight-0 assertion as passed, whatever its score.
      pass: true,
      score,
      reason: `Jev Noul probability ${score} ${score >= 0 ? '>=' : '<'} threshold 0`,
      assertion: {
        type: 'llm-rubric',
        metric,
        weight: 0,
        threshold: thresholds[metric] ?? 0.7,
      },
    })),
    ...Object.entries(unanswered).map(([metric, reason]) => ({
      pass: true,
      score: 0,
      reason,
      assertion: { type: 'llm-rubric', metric, weight: 0 },
    })),
  ];
  return {
    vars: { model, question: 'q' },
    testCase: {
      description: `A one-line description of ${caseName}`,
      metadata: { id: caseName },
    },
    success: passed,
    score: passed ? 1 : 0,
    ...(latencyMs === null ? {} : { latencyMs }),
    namedScores: {
      ...Object.fromEntries(failed.map((m) => [m, 0])),
      ...judge,
      ...Object.fromEntries(Object.keys(unanswered).map((m) => [m, 0])),
    },
    // Promptfoo: failureReason 0 passed, 1 a check failed, 2 a provider error.
    // The `error` text of a failed check is the reason of that check.
    failureReason: error ? 2 : passed ? 0 : 1,
    ...(!error && !passed ? { error: 'Custom function returned false' } : {}),
    ...(error
      ? {
          error: 'The CLI exited with code 1: boom',
          response: { error: 'boom' },
          cost: 0,
          gradingResult: null,
        }
      : {
          response: {
            output: {
              success: true,
              toolCalls: rounds.map((round) => ({ round, name: 'get_model' })),
            },
            ...(cost === undefined ? {} : { cost }),
          },
          gradingResult: {
            pass: passed,
            score: passed ? 1 : 0,
            componentResults: components,
          },
        }),
  };
};

export const resultsFile = (
  runs: ReturnType<typeof run>[],
  wall: { durationMs?: number; maxConcurrency?: number } = {},
) => ({
  evalId: 'eval-test',
  config: {},
  runtimeOptions:
    wall.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: wall.maxConcurrency },
  results: {
    results: runs,
    stats: wall.durationMs === undefined ? {} : { durationMs: wall.durationMs },
  },
});

/** `count` runs of one cell, built from the same spec. */
export const many = (count: number, spec: RunSpec = {}) =>
  Array.from({ length: count }, () => run(spec));
