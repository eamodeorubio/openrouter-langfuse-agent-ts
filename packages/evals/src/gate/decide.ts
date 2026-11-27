import { passHatK } from '../report/estimators.js';
import type { Run } from '../report/results.js';
import type { GateConfig } from './config.js';

export type Verdict = 'pass' | 'fail' | 'inconclusive';

/** One case: its passes, its provider errors, its pass^k and its floor. */
export interface Row {
  caseName: string;
  /** Passed runs. */
  c: number;
  n: number;
  errors: number;
  passHat: number;
  floor: number;
  below: boolean;
}

export type Decision =
  | {
      ok: true;
      rows: Row[];
      mean: { value: number; floor: number; below: boolean };
      verdict: Verdict;
      /** Provider errors in the whole run. */
      errors: number;
      casesBelow: number;
    }
  | { ok: false; message: string };

interface Cell {
  n: number;
  c: number;
  errors: number;
}

const mismatch = (message: string): Decision => ({ ok: false, message });

const cellsOf = (runs: Run[]): Map<string, Cell> => {
  const cells = new Map<string, Cell>();
  for (const run of runs) {
    const cell = cells.get(run.caseName) ?? { n: 0, c: 0, errors: 0 };
    cell.n += 1;
    if (run.passed) cell.c += 1;
    if (run.error) cell.errors += 1;
    cells.set(run.caseName, cell);
  }
  return cells;
};

/** The rows and the mean of the cells, with the errors counted as passed or not. */
const judge = (
  cells: Map<string, Cell>,
  config: GateConfig,
  errorsPass: boolean,
) => {
  const rows: Row[] = [...cells.keys()].sort().map((caseName) => {
    const cell = cells.get(caseName) as Cell;
    const c = errorsPass ? cell.c + cell.errors : cell.c;
    const passHat = passHatK(cell.n, c, config.k);
    const floor = config.cases[caseName] as number;
    return {
      caseName,
      c,
      n: cell.n,
      errors: cell.errors,
      passHat,
      floor,
      below: passHat < floor,
    };
  });
  const value = rows.reduce((sum, row) => sum + row.passHat, 0) / rows.length;
  return {
    rows,
    mean: { value, floor: config.mean, below: value < config.mean },
  };
};

const breaches = (judged: ReturnType<typeof judge>) =>
  judged.mean.below || judged.rows.some((row) => row.below);

/**
 * Judges the runs of one eval against the gate file. Pass when nothing is
 * below its floor. When something is, the errored runs count as passed and the
 * runs are judged again: inconclusive when nothing breaches then (the errors
 * may be the cause), fail otherwise.
 */
export const decide = (runs: Run[], config: GateConfig): Decision => {
  if (runs.length === 0) return mismatch('The results hold no run.');
  const other = runs.find((run) => run.model !== config.model);
  if (other) {
    return mismatch(
      `The results hold a run of ${other.model}, and the gate file judges ${config.model}.`,
    );
  }
  const cells = cellsOf(runs);
  for (const [caseName, cell] of cells) {
    if (cell.n !== config.repeat) {
      return mismatch(
        `The case ${caseName} has ${cell.n} runs, and the gate file says repeat ${config.repeat}.`,
      );
    }
    if (!Object.hasOwn(config.cases, caseName)) {
      return mismatch(
        `The case ${caseName} has no floor in the gate file: add it to \`cases\`.`,
      );
    }
  }
  const missing = Object.keys(config.cases).find((id) => !cells.has(id));
  if (missing !== undefined) {
    return mismatch(
      `The gate file has a floor for ${missing}, and the results hold no run of that case.`,
    );
  }

  const strict = judge(cells, config, false);
  const errors = runs.filter((run) => run.error).length;
  const verdict: Verdict = !breaches(strict)
    ? 'pass'
    : breaches(judge(cells, config, true))
      ? 'fail'
      : 'inconclusive';
  return {
    ok: true,
    ...strict,
    verdict,
    errors,
    casesBelow: strict.rows.filter((row) => row.below).length,
  };
};
