import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(import.meta.dirname, 'fixtures/fake-pnpm.mjs');

/**
 * A command that stands in for `pnpm`: a small shell wrapper, written with the
 * right mode, so that a copy of the fixtures that lost the mode still works.
 */
export const makeFakePnpm = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-fakepnpm-'));
  const command = path.join(dir, 'pnpm');
  fs.writeFileSync(
    command,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    { mode: 0o755 },
  );
  return command;
};
