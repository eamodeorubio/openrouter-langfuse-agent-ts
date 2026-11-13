import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCli } from './cliPath.js';
import type { Io } from './io.js';
import { CATALOG_ENV } from './oracle/catalog.js';
import {
  CATALOG_URL,
  fetchSnapshot,
  type Snapshot,
  SnapshotError,
  writeSnapshot,
} from './oracle/snapshot.js';
import { report } from './report/cli.js';
import { DEFAULT_KS, parseKs } from './report/ks.js';

const packageRoot = path.resolve(import.meta.dirname, '..');
const PROMPTFOO = path.join(packageRoot, 'node_modules/.bin/promptfoo');

/** Each case runs this many times per model, so that pass@k and pass^k have an n to work with. */
export const DEFAULT_REPEAT = 10;

const RESULTS_FILE = 'results.json';

export interface RunOptions {
  config: string;
  repeat: number;
  /** `core` runs the cases tagged core, `full` runs them all. */
  set: 'core' | 'full';
  out: string;
  /** Passed to the reporter as `--k`. */
  k?: string;
}

const USAGE =
  'Usage: run [--set core|full] [--config <file>] [--repeat <n>] [--k 1,3,5] [--out <dir>]\n';

/** Reads the arguments of the eval script. Returns the options, or the message that explains the mistake. */
export const parseRunArgs = (
  argv: string[],
  now: () => Date = () => new Date(),
): RunOptions | string => {
  let config = path.join(packageRoot, 'promptfooconfig.yaml');
  let repeat = DEFAULT_REPEAT;
  let set: RunOptions['set'] = 'core';
  let out: string | undefined;
  let k: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (arg === '--config' && value !== undefined) {
      config = path.resolve(value);
      i++;
    } else if (arg === '--repeat' && value !== undefined) {
      repeat = Number(value);
      if (!Number.isInteger(repeat) || repeat < 1) {
        return `--repeat takes a whole number from 1, got ${value}.`;
      }
      i++;
    } else if (arg === '--set' && value !== undefined) {
      if (value !== 'core' && value !== 'full') {
        return `--set takes core or full, got ${value}.`;
      }
      set = value;
      i++;
    } else if (arg === '--out' && value !== undefined) {
      out = path.resolve(value);
      i++;
    } else if (arg === '--k' && value !== undefined) {
      k = value;
      i++;
    } else {
      return `Unexpected argument: ${arg}`;
    }
  }
  const ks = k === undefined ? DEFAULT_KS : parseKs(k);
  if (ks === undefined) {
    return `--k takes whole numbers from 1, such as 1,3,5, got ${k}.`;
  }
  const widest = Math.max(...ks);
  if (widest > repeat) {
    return `--k ${ks.join(',')} needs at least ${widest} repeats and --repeat is ${repeat}. Raise --repeat, or lower --k.`;
  }
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  return {
    config,
    repeat,
    set,
    out: out ?? path.join(packageRoot, 'results', stamp),
    ...(k === undefined ? {} : { k }),
  };
};

/** The arguments of `promptfoo eval`: every repeat is a new request, and the results are saved as JSON. */
export const promptfooArgs = (options: RunOptions): string[] => [
  'eval',
  '-c',
  options.config,
  '--repeat',
  String(options.repeat),
  '--no-cache',
  '--no-progress-bar',
  '--no-table',
  ...(options.set === 'core' ? ['--filter-metadata', 'set=core'] : []),
  '-o',
  path.join(options.out, RESULTS_FILE),
];

/** What `run` does besides compute: fetch the catalog and start a process. Tests replace it. */
export interface Deps {
  snapshot: () => Promise<Snapshot>;
  spawn: (
    command: string,
    args: string[],
    options: SpawnSyncOptions,
  ) => {
    status: number | null;
    signal?: NodeJS.Signals | null;
    error?: Error;
  };
}

const defaultDeps: Deps = {
  snapshot: () => fetchSnapshot(process.env.EVAL_CATALOG_URL ?? CATALOG_URL),
  spawn: spawnSync,
};

/** Takes the snapshot, runs promptfoo, then the report. Returns the exit code. */
export const run = async (
  argv: string[],
  io: Io,
  deps: Deps = defaultDeps,
): Promise<number> => {
  const options = parseRunArgs(argv);
  if (typeof options === 'string') {
    io.err(`${options}\n${USAGE}`);
    return 2;
  }

  const cli = resolveCli();
  if (!fs.existsSync(cli)) {
    io.err(
      `The CLI is not built: ${cli} does not exist. Run \`pnpm build\` at the repository root, then run the evals again.\n`,
    );
    return 2;
  }

  fs.mkdirSync(options.out, { recursive: true });
  let catalog: string;
  try {
    catalog = writeSnapshot(options.out, await deps.snapshot());
  } catch (error) {
    if (!(error instanceof SnapshotError)) throw error;
    io.err(`${error.message}\n`);
    return 1;
  }

  const promptfoo = deps.spawn(PROMPTFOO, promptfooArgs(options), {
    stdio: ['ignore', 2, 2],
    env: {
      ...process.env,
      // Where the checks find the snapshot of this run.
      [CATALOG_ENV]: catalog,
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
      // A failed or errored run is data, not a reason to skip the report.
      PROMPTFOO_FAILED_TEST_EXIT_CODE: '0',
      PROMPTFOO_CONFIG_DIR: path.join(packageRoot, '.promptfoo'),
    },
  });
  if (promptfoo.error) {
    io.err(`promptfoo could not start: ${promptfoo.error.message}\n`);
    return 1;
  }
  if (promptfoo.signal) {
    io.err(`promptfoo was stopped by the signal ${promptfoo.signal}.\n`);
    return 1;
  }
  const status = promptfoo.status ?? 1;
  if (status !== 0) {
    io.err(`promptfoo stopped with exit code ${status}.\n`);
    return status;
  }

  return report(
    [
      path.join(options.out, RESULTS_FILE),
      ...(options.k === undefined ? [] : ['--k', options.k]),
    ],
    io,
  );
};
