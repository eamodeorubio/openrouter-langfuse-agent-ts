import { execFile } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules/.bin/tsx');

export interface Finished {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a TypeScript file in a child process without blocking this one, so that
 * a server of the test, on the loopback interface, can answer the child.
 */
export const runTsx = (
  args: string[],
  env: Record<string, string | undefined>,
): Promise<Finished> =>
  new Promise((resolve) => {
    execFile(
      tsx,
      args,
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        maxBuffer: 64 * 1024 * 1024,
      },
      (failure, stdout, stderr) =>
        resolve({
          status: failure
            ? typeof failure.code === 'number'
              ? failure.code
              : 1
            : 0,
          stdout,
          stderr,
        }),
    );
  });
