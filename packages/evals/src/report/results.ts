import { finite, isObject } from '../json.js';

/** One run of a case on a model, as the report reads it from promptfoo's results file. */
export interface Run {
  model: string;
  caseName: string;
  /** The run ended in a provider error. */
  error: boolean;
  /** No provider error and every counted check passed. */
  passed: boolean;
  /** The metrics of the checks that failed, judge rubrics left out. */
  failures: string[];
  /** The cost the CLI reported. Absent when none was reported, and for a provider error. */
  cost?: number;
  latencyMs?: number;
  /** The highest round of a tool call, 0 without calls. Absent for a provider error. */
  rounds?: number;
  /** Judge scores by metric. */
  judges: Record<string, number>;
}

export const DEFAULT_JUDGE_THRESHOLD = 0.7;
/** Promptfoo's `failureReason` of a run that ended in a provider error. */
const PROVIDER_ERROR = 2;
const JUDGE_PREFIX = 'judge-';

export class ResultsFormatError extends Error {}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const pathOf = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (at, key) => (isObject(at) ? at[key] : undefined),
    value,
  );

const failedMetrics = (grading: unknown): string[] => {
  const components = pathOf(grading, 'componentResults');
  if (!Array.isArray(components)) return [];
  return components.flatMap((component) => {
    const metric = text(pathOf(component, 'assertion', 'metric'));
    const failed = isObject(component) && component.pass === false;
    return failed && metric && !metric.startsWith(JUDGE_PREFIX) ? [metric] : [];
  });
};

const judgeScores = (namedScores: unknown): Record<string, number> =>
  isObject(namedScores)
    ? Object.fromEntries(
        Object.entries(namedScores).filter(
          (entry): entry is [string, number] =>
            entry[0].startsWith(JUDGE_PREFIX) && finite(entry[1]),
        ),
      )
    : {};

/** The highest `round` among the tool calls of a success object, 0 when there are none. */
const roundsOf = (output: unknown): number | undefined => {
  if (!isObject(output)) return undefined;
  const calls = output.toolCalls;
  if (!Array.isArray(calls)) return 0;
  return calls.reduce<number>((highest, call) => {
    const round = pathOf(call, 'round');
    return finite(round) ? Math.max(highest, round) : highest;
  }, 0);
};

const toRun = (entry: unknown): Run => {
  if (!isObject(entry)) {
    throw new ResultsFormatError(
      'A result in the results file is not an object.',
    );
  }
  const response = entry.response;
  // `error` also holds the reason of a failed check. A provider error is
  // `failureReason` 2, and its response holds the error.
  const error =
    entry.failureReason === PROVIDER_ERROR ||
    (entry.failureReason === undefined &&
      typeof pathOf(response, 'error') === 'string');
  const reported = pathOf(response, 'cost');
  const rounds = error ? undefined : roundsOf(pathOf(response, 'output'));
  return {
    model: text(pathOf(entry, 'vars', 'model')) ?? '(no model)',
    caseName:
      text(pathOf(entry, 'testCase', 'metadata', 'id')) ??
      text(pathOf(entry, 'testCase', 'description')) ??
      text(pathOf(entry, 'vars', 'question')) ??
      '(unnamed case)',
    error,
    passed: !error && entry.success === true,
    failures: error ? [] : failedMetrics(entry.gradingResult),
    // A provider error carries a cost of 0 in the record. It reported none.
    ...(!error && finite(reported) ? { cost: reported } : {}),
    ...(finite(entry.latencyMs) ? { latencyMs: entry.latencyMs } : {}),
    ...(rounds === undefined ? {} : { rounds }),
    judges: error ? {} : judgeScores(entry.namedScores),
  };
};

/** The judge threshold the run used, read from the provider config of the saved config. */
const thresholdOf = (file: unknown): number => {
  const threshold = pathOf(
    file,
    'config',
    'defaultTest',
    'options',
    'provider',
    'config',
    'threshold',
  );
  return finite(threshold) && threshold >= 0 && threshold <= 1
    ? threshold
    : DEFAULT_JUDGE_THRESHOLD;
};

export interface ReadResults {
  runs: Run[];
  threshold: number;
  /** How long the eval took, as promptfoo measured it. */
  wallTimeMs?: number;
  /** How many runs promptfoo ran at once. */
  concurrency?: number;
}

/** Reads the runs out of a parsed promptfoo results file. */
export const readRuns = (file: unknown): ReadResults => {
  const entries = pathOf(file, 'results', 'results');
  if (!Array.isArray(entries)) {
    throw new ResultsFormatError(
      'This is not a promptfoo results file: results.results is not a list.',
    );
  }
  const wallTimeMs = pathOf(file, 'results', 'stats', 'durationMs');
  const concurrency = pathOf(file, 'runtimeOptions', 'maxConcurrency');
  return {
    runs: entries.map(toRun),
    threshold: thresholdOf(file),
    ...(finite(wallTimeMs) && wallTimeMs >= 0 ? { wallTimeMs } : {}),
    ...(Number.isInteger(concurrency) && (concurrency as number) >= 1
      ? { concurrency: concurrency as number }
      : {}),
  };
};
