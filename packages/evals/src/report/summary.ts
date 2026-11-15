import { passAtK, passHatK } from './estimators.js';
import type { Run } from './results.js';

/** A mean over the runs that have the figure, and how many those are. */
export interface Figure {
  value: number | null;
  count: number;
}

export interface JudgeFigure {
  /** The share of scored runs at or above the threshold. Null when none was scored. */
  rate: number | null;
  scored: number;
  unscored: number;
}

export interface Stats {
  n: number;
  c: number;
  errors: number;
  failures: Record<string, number>;
  cost: Figure;
  latency: Figure;
  rounds: Figure;
  costPerSolved: number | null;
  judges: Record<string, JudgeFigure>;
  passAt: Record<number, number>;
  passHat: Record<number, number>;
}

export interface CellSummary extends Stats {
  case: string;
}

/** What one error class did over the runs it judged. */
export interface ClassSummary {
  name: string;
  /** The cases that have a check of this class. */
  cases: number;
  judged: number;
  passed: number;
  failed: number;
  /** The mean of the cases whose judged runs are at least k. Null when no case is. */
  passAt: Record<number, number | null>;
  passHat: Record<number, number | null>;
}

export interface ModelSummary {
  model: string;
  cells: CellSummary[];
  /** The error classes, in the order of the taxonomy. */
  classes: ClassSummary[];
  /** The mean of the estimators of the cells, and the figures of all the runs pooled. */
  row: Stats;
}

const mean = (values: number[]): Figure => ({
  value:
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length,
  count: values.length,
});

const defined = (values: (number | undefined)[]): number[] =>
  values.filter((value): value is number => value !== undefined);

const countBy = (names: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
};

/** The threshold of a rubric whose results state none: where Jev puts its yes. */
const DEFAULT_THRESHOLD = 0.5;

/** Everything that depends on the runs alone, not on k. */
const describe = (
  runs: Run[],
  rubrics: string[],
  thresholds: Record<string, number>,
): Omit<Stats, 'passAt' | 'passHat'> => {
  const passing = runs.filter((run) => run.passed);
  const costs = defined(runs.map((run) => run.cost));
  const solvedCost = costs.reduce((sum, cost) => sum + cost, 0);
  return {
    n: runs.length,
    c: passing.length,
    errors: runs.filter((run) => run.error).length,
    failures: countBy(runs.flatMap((run) => run.failures)),
    cost: mean(costs),
    latency: mean(defined(runs.map((run) => run.latencyMs))),
    rounds: mean(defined(runs.map((run) => run.rounds))),
    costPerSolved:
      passing.length === 0 || costs.length === 0
        ? null
        : solvedCost / passing.length,
    judges: Object.fromEntries(
      rubrics.map((rubric) => {
        const scores = defined(runs.map((run) => run.judges[rubric]));
        const threshold = thresholds[rubric] ?? DEFAULT_THRESHOLD;
        return [
          rubric,
          {
            rate:
              scores.length === 0
                ? null
                : scores.filter((score) => score >= threshold).length /
                  scores.length,
            scored: scores.length,
            unscored: runs.length - scores.length,
          },
        ];
      }),
    ),
  };
};

const estimators = (
  n: number,
  c: number,
  ks: number[],
): Pick<Stats, 'passAt' | 'passHat'> => ({
  passAt: Object.fromEntries(ks.map((k) => [k, passAtK(n, c, k)])),
  passHat: Object.fromEntries(ks.map((k) => [k, passHatK(n, c, k)])),
});

const meanOver = (
  cells: CellSummary[],
  ks: number[],
  pick: (cell: CellSummary) => Record<number, number>,
): Record<number, number> =>
  Object.fromEntries(
    ks.map((k) => [
      k,
      cells.reduce((sum, cell) => sum + (pick(cell)[k] ?? 0), 0) / cells.length,
    ]),
  );

/** The order the taxonomy lists the classes in. The others follow, by name. */
const TAXONOMY = [
  'run-failed',
  'memory-answer',
  'wrong-search',
  'wrong-answer',
  'phantom-match',
  'bad-recommendation',
  'invented-data',
  'wrong-value',
];

/**
 * How early a class comes in the chain. A class does not judge a run that a
 * class of an earlier level failed. A class that is not listed stands beside
 * the chain: only `run-failed` comes before it.
 */
const LEVEL: Record<string, number> = {
  'run-failed': 0,
  'memory-answer': 1,
  'wrong-search': 2,
  'wrong-answer': 3,
  'phantom-match': 3,
  'bad-recommendation': 3,
  'invented-data': 4,
  'wrong-value': 4,
};
const BESIDE_THE_CHAIN = 1;
const level = (name: string): number => LEVEL[name] ?? BESIDE_THE_CHAIN;

const failedClass = (run: Run, name: string): boolean =>
  // Stryker disable next-line ConditionalExpression: equivalent because only the run-failed class is asked about a run that errored, as the others judge no such run
  name === 'run-failed'
    ? run.error || run.failures.includes(name)
    : run.failures.includes(name);

/** Whether the class judged the run: it ran a check on it, and no class before it failed the run. */
const judgedBy = (run: Run, name: string): boolean => {
  if (name === 'run-failed') return true;
  // A provider error ran no check, so its `judged` is empty.
  if (!run.judged.includes(name)) return false;
  const before = (other: string) => level(other) < level(name);
  return ![...TAXONOMY, ...run.failures].some(
    (other) => before(other) && failedClass(run, other),
  );
};

const classNames = (runs: Run[]): string[] => {
  const seen = new Set<string>(['run-failed']);
  for (const run of runs) for (const name of run.judged) seen.add(name);
  const known = TAXONOMY.filter((name) => seen.has(name));
  const others = [...seen].filter((name) => !TAXONOMY.includes(name)).sort();
  return [...known, ...others];
};

const summarizeClass = (
  name: string,
  runs: Run[],
  ks: number[],
): ClassSummary => {
  const judged = runs.filter((run) => judgedBy(run, name));
  const byCase = new Map<string, Run[]>();
  for (const run of judged) {
    byCase.set(run.caseName, [...(byCase.get(run.caseName) ?? []), run]);
  }
  const cells = [...byCase.values()].map((cell) => ({
    n: cell.length,
    c: cell.filter((run) => !failedClass(run, name)).length,
  }));
  const mean = (
    estimate: (n: number, c: number, k: number) => number,
    k: number,
  ): number | null => {
    const fit = cells.filter((cell) => cell.n >= k);
    return fit.length === 0
      ? null
      : fit.reduce((sum, cell) => sum + estimate(cell.n, cell.c, k), 0) /
          fit.length;
  };
  const failed = judged.filter((run) => failedClass(run, name)).length;
  return {
    name,
    cases: cells.length,
    judged: judged.length,
    passed: judged.length - failed,
    failed,
    passAt: Object.fromEntries(ks.map((k) => [k, mean(passAtK, k)])),
    passHat: Object.fromEntries(ks.map((k) => [k, mean(passHatK, k)])),
  };
};

/** Groups the runs by model and case and works out the figures of each cell and of each model. */
export const summarize = (
  runs: Run[],
  ks: number[],
  thresholds: Record<string, number>,
): ModelSummary[] => {
  const rubrics = [...new Set(runs.flatMap((run) => run.rubrics))];
  const models = [...new Set(runs.map((run) => run.model))];
  return models.map((model) => {
    const ofModel = runs.filter((run) => run.model === model);
    const cases = [...new Set(ofModel.map((run) => run.caseName))];
    const cells = cases.map((caseName): CellSummary => {
      const ofCell = ofModel.filter((run) => run.caseName === caseName);
      const stats = describe(ofCell, rubrics, thresholds);
      return {
        case: caseName,
        ...stats,
        ...estimators(stats.n, stats.c, ks),
      };
    });
    return {
      model,
      cells,
      classes: classNames(ofModel).map((name) =>
        summarizeClass(name, ofModel, ks),
      ),
      row: {
        ...describe(ofModel, rubrics, thresholds),
        passAt: meanOver(cells, ks, (cell) => cell.passAt),
        passHat: meanOver(cells, ks, (cell) => cell.passHat),
      },
    };
  });
};
