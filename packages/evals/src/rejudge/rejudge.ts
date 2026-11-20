import fs from 'node:fs';
import path from 'node:path';
import type { Io } from '../io.js';
import { isObject } from '../json.js';
import { CATALOG_ENV } from '../oracle/catalog.js';
import { INSTRUCTIONS_ENV, INSTRUCTIONS_FILE } from '../oracle/instructions.js';
import { SNAPSHOT_FILE } from '../oracle/snapshot.js';
import { TARGET_FILE } from '../target.js';
import { formatFlip, orderFlips, summaryLine } from './flips.js';
import { type Flip, rejudgeRow } from './rows.js';
import { loadSuite, RejudgeError } from './suite.js';

const USAGE = 'Usage: rejudge <results.json>\n';

/** The directory beside the input that holds the re-judged run. */
export const OUT_DIR = 'rejudged';
const RESULTS_FILE = 'results.json';
const MARK = ' (re-judged)';

/** What the command needs from its surroundings. Tests replace it. */
export interface Deps {
  /** The root of the evals package: its `promptfooconfig.yaml` and `cases/`. */
  root: string;
}

const defaultDeps: Deps = { root: path.resolve(import.meta.dirname, '../..') };

const readFile = (file: string): Buffer | string => {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RejudgeError(`Cannot re-judge ${file}: ${reason}`);
  }
};

/** The parsed results file and its rows. Throws a `RejudgeError` that names the file when it is no promptfoo results file. */
const readResults = (
  file: string,
): {
  saved: Record<string, unknown>;
  results: Record<string, unknown>;
  rows: unknown[];
} => {
  let saved: unknown;
  try {
    saved = JSON.parse(String(readFile(file)));
  } catch (error) {
    if (error instanceof RejudgeError) throw error;
    throw new RejudgeError(`Cannot re-judge ${file}: it is not JSON.`);
  }
  const results = isObject(saved) ? saved.results : undefined;
  const rows = isObject(results) ? results.results : undefined;
  if (!isObject(saved) || !Array.isArray(rows)) {
    throw new RejudgeError(
      `Cannot re-judge ${file}: this is not a promptfoo results file, results.results is not a list.`,
    );
  }
  return { saved, results: results as Record<string, unknown>, rows };
};

/** Runs `work` with the checks pointed at the snapshot and the instructions of the run, and puts the environment back as it was. */
const withRunEnvironment = <T>(dir: string, work: () => T): T => {
  const settings = {
    [CATALOG_ENV]: path.join(dir, SNAPSHOT_FILE),
    [INSTRUCTIONS_ENV]: path.join(dir, INSTRUCTIONS_FILE),
  };
  const before = Object.fromEntries(
    Object.keys(settings).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, settings);
  try {
    return work();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The `stats` of the file with the counts of the new verdicts. A provider error is no success and no failure, as promptfoo counts it. */
const restated = (stats: unknown, rows: unknown[]): unknown => {
  if (!isObject(stats)) return stats;
  const ofRow = (row: unknown): Record<string, unknown> =>
    isObject(row) ? row : {};
  return {
    ...stats,
    successes: rows.filter((row) => ofRow(row).success === true).length,
    failures: rows.filter(
      (row) => ofRow(row).success === false && ofRow(row).failureReason !== 2,
    ).length,
  };
};

/**
 * Judges the runs of a saved results file again with the current deterministic
 * checks, writes the re-judged run beside it and prints every flip. Makes no
 * model call and no request. Returns the exit code.
 */
export const rejudge = (
  argv: string[],
  io: Io,
  deps: Deps = defaultDeps,
): number => {
  const [file, ...rest] = argv;
  if (file === undefined) {
    io.err(`The results file is missing.\n${USAGE}`);
    return 2;
  }
  if (file.startsWith('-') || rest.length > 0) {
    io.err(
      `Unexpected argument: ${file.startsWith('-') ? file : rest[0]}\n${USAGE}`,
    );
    return 2;
  }

  try {
    const dir = path.dirname(path.resolve(file));
    const { saved, results, rows } = readResults(file);
    for (const name of [SNAPSHOT_FILE, INSTRUCTIONS_FILE]) {
      if (!fs.existsSync(path.join(dir, name))) {
        throw new RejudgeError(
          `Cannot re-judge ${file}: ${name} is missing beside it, and the checks judge each run against its own.`,
        );
      }
    }
    const suite = loadSuite(deps.root);
    const flips: Flip[] = [];
    const judged = withRunEnvironment(dir, () =>
      rows.map((entry) => {
        const result = rejudgeRow(entry, suite);
        flips.push(...result.flips);
        return result.row;
      }),
    );

    const out = path.join(dir, OUT_DIR);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, RESULTS_FILE),
      JSON.stringify({
        ...saved,
        results: {
          ...results,
          results: judged,
          stats: restated(results.stats, judged),
        },
      }),
    );
    for (const name of [SNAPSHOT_FILE, INSTRUCTIONS_FILE]) {
      fs.copyFileSync(path.join(dir, name), path.join(out, name));
    }
    const target = path.join(dir, TARGET_FILE);
    fs.rmSync(path.join(out, TARGET_FILE), { force: true });
    if (fs.existsSync(target)) {
      const text = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        path.join(out, TARGET_FILE),
        text.endsWith(MARK) ? text : `${text}${MARK}`,
      );
    }

    const lines = [
      ...orderFlips(flips).map(formatFlip),
      summaryLine(flips.length, rows.length),
    ];
    io.out(`${lines.join('\n')}\n`);
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`${reason}\n`);
    return 1;
  }
};
