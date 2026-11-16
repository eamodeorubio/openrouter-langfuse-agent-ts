import fs from 'node:fs';
import path from 'node:path';
import { resolveCli } from './cliPath.js';
import { MODEL_FILTER_ENV, modelsOf, narrowModels } from './models.js';
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
import { cliVersionProblem, TARGET_FILE } from './target.js';

/** The exit code of a run that stopped in its setup, before the first request. The runner hands it on without a line of its own. */
export const SETUP_FAILED = 3;

/** The environment variable that names the results directory, which the runner passes. */
export const OUT_ENV = 'EVAL_OUT';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

/** The sentence for a build that is not there, which the runner and the hook both say. */
export const notBuilt = (cli: string): string =>
  `The CLI is not built: ${cli} does not exist. Run \`pnpm build\` at the repository root, then run the evals again.`;

/** The setup cannot start: it was given nothing to work with. */
export class SetupError extends Error {}

/** What the setup does besides compute: start a version, read a package, fetch the catalog. Tests replace it. */
export interface SetupDeps {
  /** Starts a published version once, so that its download is not in the latency of a case. */
  warm: (version: string) => Promise<void>;
  /** The entry of the installed package of a published version. */
  publishedEntry: (version: string) => Promise<string>;
  /** The instructions of the CLI that is started, which `prompt-leak` compares answers with. */
  instructions: (cli: string) => Promise<string>;
  snapshot: () => Promise<Snapshot>;
  /** Whether the entry of the local build is there. */
  exists: (file: string) => boolean;
}

/** The snapshot of the public catalog, or of the one that `EVAL_CATALOG_URL` names, which the tests point at a loopback server. */
export const takeSnapshot = (env: NodeJS.ProcessEnv): Promise<Snapshot> =>
  fetchSnapshot(env.EVAL_CATALOG_URL ?? CATALOG_URL);

const defaultDeps: SetupDeps = {
  warm: warmUp,
  publishedEntry,
  instructions: loadInstructions,
  snapshot: () => takeSnapshot(process.env),
  exists: fs.existsSync,
};

/** What the run evaluates, in words: a published version, or the entry of the local build. */
const describeTarget = (
  version: string | undefined,
  cli: string,
  models: string[] | undefined,
): string => {
  const target =
    version === undefined
      ? `local build (${path.relative(repositoryRoot, cli)})`
      : `ask-openrouter@${version}`;
  return models === undefined
    ? target
    : `${target}, models: ${models.join(', ')}`;
};

/**
 * What a run needs before its first request: the target, the instructions of
 * the CLI and the snapshot of the catalog, written beside the results, and the
 * environment that the providers and the checks read them from. Throws a
 * `PublishedError`, an `InstructionsError` or a `SnapshotError` that says why.
 * Returns the suite that promptfoo is to run when `--model` narrowed it, and
 * nothing when the run asks every model of the config.
 */
export const setup = async (
  suite: unknown,
  env: NodeJS.ProcessEnv,
  deps: SetupDeps = defaultDeps,
): Promise<{ suite: unknown } | undefined> => {
  const out = env[OUT_ENV];
  if (!out) {
    throw new SetupError(
      `${OUT_ENV} does not name the results directory. Start the run with \`pnpm eval\`, which sets it.`,
    );
  }
  const version = env.EVAL_CLI_VERSION || undefined;
  // The runner checks it too, but a run started on the config directly has no runner, and the version ends up in a process invocation.
  const problem =
    version === undefined ? undefined : cliVersionProblem(version);
  if (problem !== undefined) throw new SetupError(problem);
  // Before the warm-up and the catalog, which are requests.
  const filter = env[MODEL_FILTER_ENV];
  const narrowed =
    filter === undefined ? undefined : narrowModels(suite, filter);
  if (typeof narrowed === 'string') throw new SetupError(narrowed);
  let cli = resolveCli();
  if (version !== undefined) {
    await deps.warm(version);
    cli = await deps.publishedEntry(version);
  } else if (!deps.exists(cli)) {
    // The runner checks it first, and stops with code 2. A run on the config directly has no runner.
    throw new SetupError(notBuilt(cli));
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, TARGET_FILE),
    describeTarget(version, cli, narrowed?.models),
  );
  env[INSTRUCTIONS_ENV] = writeInstructions(out, await deps.instructions(cli));
  env[CATALOG_ENV] = writeSnapshot(out, await deps.snapshot());
  // So that no repeat picks one of the models under test as the free model.
  env.EVAL_MODELS = (narrowed?.models ?? modelsOf(suite)).join(',');
  return narrowed === undefined ? undefined : { suite: narrowed.suite };
};

/**
 * The extension of the config: sets the run up before its first request. A
 * failure of the setup is written as one sentence on stderr and stops the
 * process with `SETUP_FAILED`, so that it reads as it does from the runner. It
 * exits, and does not throw, because a throw reaches the user as the error
 * block of promptfoo. Anything else is a bug, and is thrown.
 */
export const runHook = async (
  hookName: string,
  context: { suite?: unknown },
  deps: SetupDeps = defaultDeps,
): Promise<{ suite: unknown } | undefined> => {
  if (hookName !== 'beforeAll') return undefined;
  try {
    return await setup(context.suite, process.env, deps);
  } catch (error) {
    if (
      !(
        error instanceof SetupError ||
        error instanceof PublishedError ||
        error instanceof InstructionsError ||
        error instanceof SnapshotError
      )
    ) {
      throw error;
    }
    process.stderr.write(`${error.message}\n`);
    process.exit(SETUP_FAILED);
  }
};

/** The hook that the config names. */
export const extensionHook = (
  hookName: string,
  context: { suite?: unknown },
): Promise<{ suite: unknown } | undefined> => runHook(hookName, context);
