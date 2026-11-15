import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A command that stands in for `pnpm`: a small shell wrapper, written with the
 * right mode, so that a copy of the fixtures that lost the mode still works.
 */
export const makeFakeCommand = (name: string, fixture: string): string => {
  const script = path.join(import.meta.dirname, 'fixtures', fixture);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evals-fake${name}-`));
  const command = path.join(dir, name);
  fs.writeFileSync(
    command,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    { mode: 0o755 },
  );
  return command;
};

export const makeFakePnpm = (): string =>
  makeFakeCommand('pnpm', 'fake-pnpm.mjs');

export const makeFakeClaude = (): string =>
  makeFakeCommand('claude', 'fake-claude.mjs');
