import type { ClassSummary, Figure, ModelSummary, Stats } from './summary.js';

const fixed = (value: number, digits: number): string => value.toFixed(digits);

/** `value (count runs)`, or `n/a (0 runs)`. */
const withCount = (label: string, figure: Figure, digits: number): string =>
  `${label} ${figure.value === null ? 'n/a' : fixed(figure.value, digits)} (${figure.count} runs)`;

const estimatorColumns = (stats: Stats, ks: number[]): string =>
  [
    ks.map((k) => `pass@${k}=${fixed(stats.passAt[k] ?? 0, 4)}`).join(' '),
    ks.map((k) => `pass^${k}=${fixed(stats.passHat[k] ?? 0, 4)}`).join(' '),
  ].join('  ');

const lines = (
  label: string,
  width: number,
  stats: Stats,
  ks: number[],
): string[] => {
  const pad = ' '.repeat(width + 4);
  const failures = Object.entries(stats.failures)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name}=${count}`);
  return [
    `  ${label.padEnd(width)}  n=${stats.n}  c=${stats.c}  err=${stats.errors}  ${estimatorColumns(stats, ks)}`,
    ...(failures.length > 0 ? [`${pad}failed: ${failures.join(' ')}`] : []),
    `${pad}${[
      withCount('cost', stats.cost, 4),
      `latency ${stats.latency.value === null ? 'n/a' : `${Math.round(stats.latency.value)} ms`}`,
      withCount('rounds', stats.rounds, 2),
      `cost/solved ${stats.costPerSolved === null ? '-' : fixed(stats.costPerSolved, 4)}`,
    ].join('  ')}`,
    ...Object.entries(stats.judges).map(
      ([rubric, judge]) =>
        `${pad}${rubric} ${judge.rate === null ? 'n/a' : fixed(judge.rate, 2)} (${judge.unscored} unscored)`,
    ),
  ];
};

const estimate = (value: number | null): string =>
  value === null ? '-' : fixed(value, 4);

/** The error classes of a model: how many runs each judged, passed and failed, and its estimators. */
const classLines = (classes: ClassSummary[], ks: number[]): string[] => {
  const width = Math.max(...classes.map((entry) => entry.name.length));
  return [
    '  by error class',
    ...classes.map((entry) => {
      const at = ks.map(
        (k) => `pass@${k}=${estimate(entry.passAt[k] as number | null)}`,
      );
      const hat = ks.map(
        (k) => `pass^${k}=${estimate(entry.passHat[k] as number | null)}`,
      );
      return `    ${entry.name.padEnd(width)}  judged=${entry.judged}  passed=${entry.passed}  failed=${entry.failed}  ${at.join(' ')}  ${hat.join(' ')}`;
    }),
  ];
};

/** What a file says about how the eval ran. */
interface Timing {
  wallTimeMs?: number;
  concurrency?: number;
}

/** The line that ends the report: how long the eval took for how many runs. Empty without a time. */
export const wallTimeLine = (timing: Timing, runs: number): string =>
  timing.wallTimeMs === undefined
    ? ''
    : `wall time ${(timing.wallTimeMs / 1000).toFixed(1)} s for ${runs} ${runs === 1 ? 'run' : 'runs'}${timing.concurrency === undefined ? '' : ` (concurrency ${timing.concurrency})`}\n`;

/** The report as text: a block per model, a line group per cell, then the mean row. */
export const formatReport = (models: ModelSummary[], ks: number[]): string => {
  const width = Math.max(
    4,
    ...models.flatMap((model) => model.cells.map((cell) => cell.case.length)),
  );
  return models
    .flatMap((model) => [
      model.model,
      ...model.cells.flatMap((cell) => lines(cell.case, width, cell, ks)),
      ...lines('mean', width, model.row, ks),
      ...classLines(model.classes, ks),
      '',
    ])
    .join('\n');
};
