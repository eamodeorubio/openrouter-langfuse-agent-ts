import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_CLI, resolveCli } from '../src/cliPath.js';

afterEach(() => vi.unstubAllEnvs());

describe('the CLI an eval run starts', () => {
  it('is the built CLI of the cli package by default', () => {
    expect(BUILT_CLI).toBe(
      path.resolve(import.meta.dirname, '../../cli/dist/index.js'),
    );
  });

  it('is the built CLI when nothing else is named', () => {
    delete process.env.EVAL_CLI;
    expect(resolveCli()).toBe(BUILT_CLI);
  });

  it('is EVAL_CLI when it is set', () => {
    vi.stubEnv('EVAL_CLI', '/from/env.js');
    expect(resolveCli()).toBe('/from/env.js');
  });

  it('is the one the config names, before EVAL_CLI', () => {
    vi.stubEnv('EVAL_CLI', '/from/env.js');
    expect(resolveCli('/from/config.js')).toBe('/from/config.js');
  });
});
