// A stand-in for `pnpm`. It logs how it was started, answers `dlx` the way
// pnpm does for the three calls the evals make, and runs the stub CLI for a run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (process.env.FAKE_PNPM_LOG) {
  fs.appendFileSync(process.env.FAKE_PNPM_LOG, `${JSON.stringify(args)}\n`);
}

const stub = path.join(import.meta.dirname, 'stub-cli.mjs');
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (args[0] !== 'dlx') fail(`fake pnpm: not a dlx call: ${args.join(' ')}`);
if (process.env.FAKE_PNPM_SLEEP)
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_PNPM_SLEEP)));
if (process.env.FAKE_PNPM_FAIL) fail(process.env.FAKE_PNPM_FAIL);

const rest = args.slice(1);
if (rest[0]?.startsWith('--package=')) {
  // The path of the binary of a package, as `command -v` prints it.
  process.stdout.write(`${process.env.FAKE_PNPM_BIN ?? ''}\n`);
} else if (rest[1] === '--version') {
  const wanted = rest[0].slice(rest[0].indexOf('@') + 1);
  process.stdout.write(`${process.env.FAKE_PNPM_VERSION ?? wanted}\n`);
} else {
  const run = spawnSync(process.execPath, [stub, ...rest.slice(1)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(run.status ?? 1);
}
