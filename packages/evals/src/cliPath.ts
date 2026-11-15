import path from 'node:path';

/** The CLI that ships: `packages/cli/dist/index.js`, found from `packages/evals/src/`. */
export const BUILT_CLI = path.resolve(
  import.meta.dirname,
  '../../cli/dist/index.js',
);

/** The CLI an eval run starts: the one the config names, else `EVAL_CLI`, else the built CLI. */
export const resolveCli = (configured?: string): string =>
  configured ?? process.env.EVAL_CLI ?? BUILT_CLI;
