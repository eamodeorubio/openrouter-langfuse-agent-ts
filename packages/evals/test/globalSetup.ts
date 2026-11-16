import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** The settings that test/setup.ts removes from the environment of the tests, and so from this step too. */
const SETTINGS = /^(OPENROUTER_|TYPESAFE_|LANGFUSE_|OTEL_|PROMPTFOO_|EVAL_)/;

/**
 * Creates the state database of promptfoo once, before any test file starts.
 * Promptfoo migrates it at the start of every invocation, and `--version` is
 * the cheapest one that gets that far. Test files that start promptfoo at the
 * same moment, against a directory that has no database yet, as on a CI runner,
 * all try to create its tables, and one of them fails with "table already
 * exists". Run alone and first, the migration is done by the time the others
 * start.
 */
export default function setup(): void {
  // This runs before test/setup.ts, so the environment is still that of the shell.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SETTINGS.test(name)),
  );
  execFileSync(path.join(root, 'node_modules/.bin/promptfoo'), ['--version'], {
    // The directory decides which config file promptfoo reads besides the database.
    cwd: root,
    // Stderr stays visible: it is the only trace of a migration that failed.
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 120_000,
    env: {
      ...env,
      // The same directory as the runner and the tests use.
      PROMPTFOO_CONFIG_DIR: path.join(root, '.promptfoo'),
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
    },
  });
}
