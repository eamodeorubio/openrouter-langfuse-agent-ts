import { finite, isObject } from '../json.js';
import { resolveCheck } from './checks.js';
import { RejudgeError, type Suite } from './suite.js';

/** What a check said of a run. `absent`: the row has no such check on that side of the re-judge. */
export type Verdict = 'pass' | 'fail' | 'absent';

/** A check whose verdict on one run is not the one saved. */
export interface Flip {
  caseId: string;
  model: string;
  repeat: number;
  metric: string;
  before: Verdict;
  after: Verdict;
}

/** Promptfoo's `failureReason` of a run that ended in a provider error. */
const PROVIDER_ERROR = 2;
const PASSED = 'All assertions passed';

interface Component {
  pass: boolean;
  score: number;
  reason: string;
  assertion: { type: string; metric?: string; weight?: number } & Record<
    string,
    unknown
  >;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Whether the saved row is a provider error, as the report reads it. */
const isProviderError = (entry: Record<string, unknown>): boolean => {
  const response = entry.response;
  return (
    entry.failureReason === PROVIDER_ERROR ||
    (entry.failureReason === undefined &&
      isObject(response) &&
      typeof response.error === 'string')
  );
};

const savedComponents = (entry: Record<string, unknown>): Component[] => {
  const grading = entry.gradingResult;
  const list = isObject(grading) ? grading.componentResults : undefined;
  return Array.isArray(list) ? (list as Component[]) : [];
};

const verdictOf = (component: Component): Verdict =>
  component.pass ? 'pass' : 'fail';

/**
 * The components with a key that tells two checks of one metric apart: the
 * metric and its occurrence in the row. `invented-data` is the metric of a
 * check of every case and of a second check on some, and they pair in order.
 */
const withOccurrence = (components: Component[]): [string, Component][] =>
  components.map((component, index) => {
    const metric = String(component.assertion.metric);
    const earlier = components
      .slice(0, index)
      .filter((other) => String(other.assertion.metric) === metric).length;
    return [`${metric}#${earlier}`, component];
  });

/**
 * The scores and weights promptfoo keeps by metric. A metric of two checks
 * keeps the mean of their scores and a weight of 2: each component counts once
 * there, whatever its own weight.
 */
const named = (
  components: Component[],
): {
  namedScores: Record<string, number>;
  namedScoreWeights: Record<string, number>;
} => {
  const sums = new Map<string, { total: number; count: number }>();
  for (const component of components) {
    const metric = String(component.assertion.metric);
    const sum = sums.get(metric) ?? { total: 0, count: 0 };
    sums.set(metric, {
      total: sum.total + component.score,
      count: sum.count + 1,
    });
  }
  return {
    namedScores: Object.fromEntries(
      [...sums].map(([metric, { total, count }]) => [metric, total / count]),
    ),
    namedScoreWeights: Object.fromEntries(
      [...sums].map(([metric, { count }]) => [metric, count]),
    ),
  };
};

/** The score promptfoo gives a row: the mean of the component scores by their weights, 1 when an assertion states none. */
const weightedMean = (components: Component[]): number => {
  let total = 0;
  let weights = 0;
  for (const component of components) {
    const weight = component.assertion.weight ?? 1;
    total += component.score * weight;
    weights += weight;
  }
  return weights === 0 ? 0 : total / weights;
};

/**
 * Judges one saved row again with the current checks. Returns the row rebuilt
 * from the new verdicts, and the checks whose verdict changed. The row it was
 * given is not modified. A row that ended in a provider error comes back as it
 * was. Throws a `RejudgeError` that names the case, and the model and the
 * repeat when it knows them, for a row it cannot judge.
 */
export const rejudgeRow = (
  entry: unknown,
  suite: Suite,
): { row: unknown; flips: Flip[] } => {
  if (!isObject(entry)) {
    throw new RejudgeError('A result in the results file is not an object.');
  }
  if (isProviderError(entry)) return { row: entry, flips: [] };

  const testCase = isObject(entry.testCase) ? entry.testCase : {};
  const metadata = isObject(testCase.metadata) ? testCase.metadata : {};
  const caseId = text(metadata.id);
  if (caseId === undefined) {
    throw new RejudgeError(
      'A result has no testCase.metadata.id, so no case of the config can judge it.',
    );
  }
  const found = suite.cases.get(caseId);
  if (found === undefined) {
    throw new RejudgeError(
      `The case ${caseId} is not in the config of this working tree.`,
    );
  }
  const vars = isObject(entry.vars) ? entry.vars : {};
  const model = text(vars.model) ?? '(no model)';
  const repeat = finite(entry.repeatIndex) ? entry.repeatIndex : 0;
  const where = `${caseId}, model ${model}, repeat ${repeat}`;
  const output = isObject(entry.response) ? entry.response.output : undefined;
  const context = { test: { metadata: found.metadata, vars }, vars };

  const fresh: Component[] = [...suite.defaults, ...found.assert].map(
    (assertion) => {
      const check = resolveCheck(assertion.value);
      if (check === undefined) {
        throw new RejudgeError(
          `The case ${caseId} has the assertion ${assertion.metric}, which is not a check of src/checks/assertions.ts.`,
        );
      }
      try {
        const result = check(output, context);
        return {
          pass: result.pass,
          score: result.score,
          reason: result.reason,
          assertion: {
            type: 'javascript',
            metric: assertion.metric,
            value: assertion.value,
          },
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new RejudgeError(
          `The check ${assertion.metric} failed on ${where}: ${reason}`,
        );
      }
    },
  );

  const saved = savedComponents(entry);
  const before = new Map(
    withOccurrence(
      saved.filter((component) => component.assertion.type === 'javascript'),
    ),
  );
  const flips: Flip[] = [];
  const flip = (metric: string, was: Verdict, now: Verdict): void => {
    if (was !== now) {
      flips.push({ caseId, model, repeat, metric, before: was, after: now });
    }
  };
  for (const [key, component] of withOccurrence(fresh)) {
    const old = before.get(key);
    flip(
      component.assertion.metric as string,
      old === undefined ? 'absent' : verdictOf(old),
      verdictOf(component),
    );
    before.delete(key);
  }
  for (const old of before.values()) {
    flip(old.assertion.metric as string, verdictOf(old), 'absent');
  }

  const rubrics = saved.filter(
    (component) => component.assertion.type !== 'javascript',
  );
  const components = [...fresh, ...rubrics];
  // A rubric weighs 0, so it never decides a verdict, whatever it saved.
  const failing = fresh.filter((component) => !component.pass);
  const passed = failing.length === 0;
  const reason = passed
    ? PASSED
    : (failing[failing.length - 1] as Component).reason;
  const score = weightedMean(components);

  const row = structuredClone(entry);
  const grading = isObject(row.gradingResult) ? row.gradingResult : {};
  row.success = passed;
  row.score = score;
  row.failureReason = passed ? 0 : 1;
  if (passed) delete row.error;
  else row.error = reason;
  const { namedScores, namedScoreWeights } = named(components);
  row.namedScores = namedScores;
  row.gradingResult = {
    ...grading,
    pass: passed,
    score,
    reason,
    namedScores,
    namedScoreWeights,
    componentResults: components,
  };
  return { row, flips };
};
