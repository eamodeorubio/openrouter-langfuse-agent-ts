import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCli } from './cliPath.js';
import { notBuilt, OUT_ENV, SETUP_FAILED } from './hooks.js';
import type { Io } from './io.js';
import { MODEL_FILTER_ENV } from './models.js';
import { report } from './report/cli.js';
import { DEFAULT_KS, parseKs } from './report/ks.js';
import { SET_NAMES, type SetName } from './sets.js';
import { cliVersionProblem } from './target.js';

const packageRoot = path.resolve(import.meta.dirname, '..');
const PROMPTFOO = path.join(packageRoot, 'node_modules/.bin/promptfoo');

/** Each case runs this many times per model, so that pass@k and pass^k have an n to work with. */
export const DEFAULT_REPEAT = 10;

const RESULTS_FILE = 'results.json';

export interface RunOptions {
  config: string;
  repeat: number;
  /** The sets overlap: `core` is a case for each error class, `judge` the cases a rubric grades, and `full` every case. */
  set: SetName;
  out: string;
  /** Passed to the reporter as `--k`. */
  k?: string;
  /** The published version of the CLI to evaluate. Absent for the local build. */
  cliVersion?: string;
  /** The models to ask, as written: a comma list that the setup checks against the config. Absent for every model of the config. */
  model?: string;
}

const USAGE = `Usage: run [--set ${SET_NAMES.join('|')}] [--config <file>] [--repeat <n>] [--k 1,3,5] [--out <dir>] [--cli-version <x.y.z>] [--model <id[,id...]>]\n`;

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
  let cliVersion: string | undefined;
  let model: string | undefined;
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
      if (!SET_NAMES.includes(value as SetName)) {
        return `--set takes ${SET_NAMES.slice(0, -1).join(', ')} or ${SET_NAMES.at(-1)}, got ${value}.`;
      }
      set = value as SetName;
      i++;
    } else if (arg === '--out' && value !== undefined) {
      out = path.resolve(value);
      i++;
    } else if (arg === '--cli-version' && value !== undefined) {
      const problem = cliVersionProblem(value);
      if (problem !== undefined) return problem;
      cliVersion = value;
      i++;
    } else if (arg === '--model' && value !== undefined) {
      model = value;
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
    ...(cliVersion === undefined ? {} : { cliVersion }),
    ...(model === undefined ? {} : { model }),
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
  // A case names its sets in its metadata, and promptfoo matches the name in the list.
  ...(options.set === 'full'
    ? []
    : ['--filter-metadata', `set=${options.set}`]),
  '-o',
  path.join(options.out, RESULTS_FILE),
];

/** What `run` does besides compute: start a process. Tests replace it. */
export interface Deps {
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

const defaultDeps: Deps = { spawn: spawnSync };

/** Checks the arguments and the build, runs promptfoo, whose hook does the setup, then the report. Returns the exit code. */
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
  if (options.cliVersion === undefined && !fs.existsSync(cli)) {
    io.err(`${notBuilt(cli)}\n`);
    return 2;
  }

  fs.mkdirSync(options.out, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The published version the provider starts, or none for the local build.
    EVAL_CLI_VERSION: options.cliVersion ?? '',
    // Where the hook of the config writes the target, the instructions and the snapshot of the run.
    [OUT_ENV]: options.out,
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    // A failed or errored run is data, not a reason to skip the report.
    PROMPTFOO_FAILED_TEST_EXIT_CODE: '0',
    PROMPTFOO_CONFIG_DIR: path.join(packageRoot, '.promptfoo'),
  };
  // The models to keep, or none: a filter left in the shell must not narrow a run that asked for none.
  if (options.model === undefined) delete env[MODEL_FILTER_ENV];
  else env[MODEL_FILTER_ENV] = options.model;
  const promptfoo = deps.spawn(PROMPTFOO, promptfooArgs(options), {
    stdio: ['ignore', 2, 2],
    env,
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
  // The hook has said why, in one sentence, on stderr.
  if (status === SETUP_FAILED) return status;
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
