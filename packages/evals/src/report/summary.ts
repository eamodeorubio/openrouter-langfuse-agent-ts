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

export interface ModelSummary {
  model: string;
  cells: CellSummary[];
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

/** Everything that depends on the runs alone, not on k. */
const describe = (
  runs: Run[],
  rubrics: string[],
  threshold: number,
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

/** Groups the runs by model and case and works out the figures of each cell and of each model. */
export const summarize = (
  runs: Run[],
  ks: number[],
  threshold: number,
): ModelSummary[] => {
  const rubrics = [...new Set(runs.flatMap((run) => Object.keys(run.judges)))];
  const models = [...new Set(runs.map((run) => run.model))];
  return models.map((model) => {
    const ofModel = runs.filter((run) => run.model === model);
    const cases = [...new Set(ofModel.map((run) => run.caseName))];
    const cells = cases.map((caseName): CellSummary => {
      const ofCell = ofModel.filter((run) => run.caseName === caseName);
      const stats = describe(ofCell, rubrics, threshold);
      return {
        case: caseName,
        ...stats,
        ...estimators(stats.n, stats.c, ks),
      };
    });
    return {
      model,
      cells,
      row: {
        ...describe(ofModel, rubrics, threshold),
        passAt: meanOver(cells, ks, (cell) => cell.passAt),
        passHat: meanOver(cells, ks, (cell) => cell.passHat),
      },
    };
  });
};
