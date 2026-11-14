import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { resolveCli } from './cliPath.js';
import type { Io } from './io.js';
import { isObject } from './json.js';
import { CATALOG_ENV } from './oracle/catalog.js';
import {
  INSTRUCTIONS_ENV,
  InstructionsError,
  loadInstructions,
  writeInstructions,
} from './oracle/instructions.js';
import {
  CATALOG_URL,
  fetchSnapshot,
  type Snapshot,
  SnapshotError,
  writeSnapshot,
} from './oracle/snapshot.js';
import { PublishedError, publishedEntry, warmUp } from './published.js';
import { report } from './report/cli.js';
import { DEFAULT_KS, parseKs } from './report/ks.js';
import { SET_NAMES, type SetName } from './sets.js';
import { cliVersionProblem, TARGET_FILE } from './target.js';

const packageRoot = path.resolve(import.meta.dirname, '..');
const PROMPTFOO = path.join(packageRoot, 'node_modules/.bin/promptfoo');

/** Each case runs this many times per model, so that pass@k and pass^k have an n to work with. */
export const DEFAULT_REPEAT = 10;

const RESULTS_FILE = 'results.json';
const repositoryRoot = path.resolve(packageRoot, '../..');

/** What the run evaluates, in words: a published version, or the entry of the local build. */
const describeTarget = (version: string | undefined, cli: string): string =>
  version === undefined
    ? `local build (${path.relative(repositoryRoot, cli)})`
    : `ask-openrouter@${version}`;

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
}

const USAGE = `Usage: run [--set ${SET_NAMES.join('|')}] [--config <file>] [--repeat <n>] [--k 1,3,5] [--out <dir>] [--cli-version <x.y.z>]\n`;

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

/** The models of the matrix of a config, which the provider must not pick as the free model. None when the config does not say, and promptfoo complains about it later. */
export const modelsUnderTest = (config: string): string[] => {
  try {
    const parsed: unknown = parse(fs.readFileSync(config, 'utf8'));
    const defaults = isObject(parsed) ? parsed.defaultTest : undefined;
    const vars = isObject(defaults) ? defaults.vars : undefined;
    const model = isObject(vars) ? vars.model : undefined;
    const list = Array.isArray(model) ? model : [model];
    return list.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
};

/** What `run` does besides compute: fetch the catalog and start a process. Tests replace it. */
export interface Deps {
  /** Starts a published version once, so that its download is not in the latency of a case. */
  warm: (version: string) => Promise<void>;
  /** The entry of the installed package of a published version. */
  publishedEntry: (version: string) => Promise<string>;
  /** The instructions of the CLI that is started, which `prompt-leak` compares answers with. */
  instructions: (cli: string) => Promise<string>;
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
  warm: warmUp,
  publishedEntry,
  instructions: loadInstructions,
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

  let cli = resolveCli();
  if (options.cliVersion === undefined) {
    if (!fs.existsSync(cli)) {
      io.err(
        `The CLI is not built: ${cli} does not exist. Run \`pnpm build\` at the repository root, then run the evals again.\n`,
      );
      return 2;
    }
  } else {
    try {
      await deps.warm(options.cliVersion);
      cli = await deps.publishedEntry(options.cliVersion);
    } catch (error) {
      if (!(error instanceof PublishedError)) throw error;
      io.err(`${error.message}\n`);
      return 1;
    }
  }
  const target = describeTarget(options.cliVersion, cli);

  fs.mkdirSync(options.out, { recursive: true });
  fs.writeFileSync(path.join(options.out, TARGET_FILE), target);
  let instructions: string;
  try {
    instructions = writeInstructions(options.out, await deps.instructions(cli));
  } catch (error) {
    if (!(error instanceof InstructionsError)) throw error;
    io.err(`${error.message}\n`);
    return 1;
  }
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
      // The published version the provider starts, or none for the local build.
      EVAL_CLI_VERSION: options.cliVersion ?? '',
      // Where the checks find the instructions of the CLI under test.
      [INSTRUCTIONS_ENV]: instructions,
      // The models of the matrix, so that no repeat picks one as the free model.
      EVAL_MODELS: modelsUnderTest(options.config).join(','),
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
