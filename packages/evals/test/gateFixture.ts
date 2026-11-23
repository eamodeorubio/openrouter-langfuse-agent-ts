import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { many, resultsFile } from './resultsFixture.js';

/** One cell of a results file: a case on a model, with `passed` passes, `errors` provider errors and `failed` failed checks. */
export interface Cell {
  caseName: string;
  passed: number;
  errors?: number;
  failed?: number;
  model?: string;
}

export const cellRuns = ({
  caseName,
  passed,
  errors = 0,
  failed = 0,
  model = 'm/one',
}: Cell) => [
  ...many(passed, { caseName, model }),
  ...many(errors, { caseName, model, error: true }),
  ...many(failed, { caseName, model, failed: ['check'] }),
];

/** A results file of the given cells. A cell with no `failed` fills up to `n` runs with failed checks. */
export const resultsOf = (cells: Cell[], n = 10) =>
  resultsFile(
    cells.flatMap((cell) =>
      cellRuns({
        ...cell,
        failed: cell.failed ?? n - cell.passed - (cell.errors ?? 0),
      }),
    ),
  );

export const tempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'evals-gate-'));

export const writeIn = (dir: string, name: string, content: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};

export const GATE_YAML = `model: m/one
repeat: 10
k: 3
mean: 0.85
cases:
  a/one: 0.4
  a/two: 0.4
  a/three: 0.05
`;
