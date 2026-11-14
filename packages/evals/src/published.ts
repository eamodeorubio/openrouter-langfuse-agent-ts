import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = 'ask-openrouter';
const TIMEOUT_MS = 180_000;

/** A published version could not be started, or answered as another version. */
export class PublishedError extends Error {}

/** The command that starts pnpm: `pnpm` on the path, unless `EVAL_PNPM` names another. */
export const pnpmCommand = (): string => process.env.EVAL_PNPM ?? 'pnpm';

/** The arguments that start a published version, before the arguments of the CLI itself. */
export const dlxArguments = (version: string): string[] => [
  'dlx',
  `${PACKAGE}@${version}`,
];

interface Finished {
  stdout: string;
  stderr: string;
  failed: boolean;
}

/** The last line of what a process printed: pnpm may print a notice before the answer. */
const lastLine = (text: string): string =>
  text.trim().split('\n').pop() as string;

/** Runs pnpm with an argument array. Never rejects: a failure is in the result. */
const run = (args: string[], timeoutMs: number): Promise<Finished> =>
  new Promise((resolve) => {
    execFile(
      pnpmCommand(),
      args,
      { encoding: 'utf8', timeout: timeoutMs },
      (failure, stdout, stderr) =>
        resolve({
          stdout,
          stderr: failure?.killed
            ? `timed out after ${timeoutMs / 1000} s`
            : failure && !stderr
              ? failure.message
              : stderr,
          failed: failure !== null,
        }),
    );
  });

/**
 * Starts a published version once, so that its download is not part of the
 * latency of any case, and checks that it is the version that was asked for.
 */
export const warmUp = async (
  version: string,
  timeoutMs = TIMEOUT_MS,
): Promise<void> => {
  const target = `${PACKAGE}@${version}`;
  const done = await run([...dlxArguments(version), '--version'], timeoutMs);
  if (done.failed) {
    throw new PublishedError(
      `Could not start ${target} through pnpm dlx: ${done.stderr.trim()}`,
    );
  }
  const answered = lastLine(done.stdout);
  if (answered !== version) {
    throw new PublishedError(
      `The warm-up of ${target} answered ${answered === '' ? 'nothing' : answered}.`,
    );
  }
};

/**
 * The entry of the package that `pnpm dlx` installed: its `.bin` directory
 * sits beside the package directory, which is where `instructions.js` is.
 * It asks a POSIX shell for the path, so it needs macOS or Linux.
 */
export const publishedEntry = async (
  version: string,
  timeoutMs = TIMEOUT_MS,
): Promise<string> => {
  const target = `${PACKAGE}@${version}`;
  const done = await run(
    ['dlx', `--package=${target}`, '-c', `command -v ${PACKAGE}`],
    timeoutMs,
  );
  if (done.failed) {
    throw new PublishedError(
      `Could not find ${target} through pnpm dlx: ${done.stderr.trim()}`,
    );
  }
  const bin = lastLine(done.stdout);
  if (bin === '') {
    throw new PublishedError(
      `pnpm dlx installed ${target} but reported no ${PACKAGE} binary.`,
    );
  }
  const entry = path.join(path.dirname(bin), '..', PACKAGE, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new PublishedError(
      `pnpm dlx installed ${target}, and ${entry} is not there.`,
    );
  }
  return entry;
};
