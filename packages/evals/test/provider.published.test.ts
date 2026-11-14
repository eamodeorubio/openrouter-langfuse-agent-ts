import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CliProvider from '../src/provider/cli.js';
import { makeFakePnpm } from './fakePnpm.js';

const fakePnpm = makeFakePnpm();

let log: string;
beforeEach(() => {
  log = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'evals-pnpm-')),
    'calls.log',
  );
  vi.stubEnv('EVAL_PNPM', fakePnpm);
  vi.stubEnv('EVAL_CLI_VERSION', '1.1.0');
  vi.stubEnv('FAKE_PNPM_LOG', log);
});
afterEach(() => vi.unstubAllEnvs());

const calls = (): string[][] =>
  fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);

const call = (question: string, model = 'm/one') =>
  new CliProvider({ config: { timeoutMs: 20_000 } }).callApi(question, {
    vars: { model },
  });

describe('a published version', () => {
  it('is started through pnpm dlx with the version of the target and the arguments of a run', async () => {
    const result = await call('ok');
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ question: 'ok', model: 'm/one' });
    expect(calls()).toEqual([
      ['dlx', 'ask-openrouter@1.1.0', '--json', '--model', 'm/one', '-q', 'ok'],
    ]);
  });

  it('hands a question with shell syntax over unchanged, and runs no command', async () => {
    const question = 'echo "quoted" $(id) ; touch /tmp/never\nsecond `x`';
    const result = await call(question);
    const argv = JSON.parse((result.output as { answer: string }).answer);
    expect(argv).toEqual(['--json', '--model', 'm/one', '-q', question]);
    expect(calls()[0]?.at(-1)).toBe(question);
  });

  it('starts pnpm from the path unless EVAL_PNPM names another', async () => {
    const dir = path.dirname(fakePnpm);
    vi.stubEnv('EVAL_PNPM', undefined as never);
    delete process.env.EVAL_PNPM;
    vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH ?? ''}`);
    const result = await call('ok');
    expect(result.error).toBeUndefined();
    expect(calls()).toHaveLength(1);
  });

  it('carries the target in the id of the provider', () => {
    expect(new CliProvider().id()).toBe('ask-openrouter-cli@1.1.0');
    expect(new CliProvider({ id: 'other' }).id()).toBe('other@1.1.0');
  });

  it.each(['latest', '^1.1.0', '1.0.1', '--use-stderr', '1.1.0; id'])(
    'refuses a version that is not an exact one from 1.1.0 when it is built: %s',
    (version) => {
      vi.stubEnv('EVAL_CLI_VERSION', version);
      expect(() => new CliProvider()).toThrow(
        `EVAL_CLI_VERSION must be an exact version from 1.1.0, got ${JSON.stringify(version)}.`,
      );
    },
  );

  it('keeps the id of the local build when no version is set', () => {
    vi.stubEnv('EVAL_CLI_VERSION', '');
    expect(new CliProvider().id()).toBe('ask-openrouter-cli');
  });

  it('starts the local build, not pnpm, when no version is set', async () => {
    vi.stubEnv('EVAL_CLI_VERSION', '');
    vi.stubEnv(
      'EVAL_CLI',
      path.join(import.meta.dirname, 'fixtures/stub-cli.mjs'),
    );
    const result = await call('ok');
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(log)).toBe(false);
  });

  it('ends in a provider error that names the exit code, as the local build does', async () => {
    const result = await call('exit1');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/^The CLI exited with code 1: /);
  });

  it('ends in a provider error when pnpm itself fails or cannot start', async () => {
    vi.stubEnv('FAKE_PNPM_FAIL', 'ERR_PNPM_NO_NETWORK');
    expect((await call('ok')).error).toBe(
      'The CLI exited with code 1: ERR_PNPM_NO_NETWORK',
    );
    vi.stubEnv('EVAL_PNPM', '/nonexistent/pnpm');
    expect((await call('ok')).error).toMatch(/^The CLI did not finish: /);
  });

  it('reads garbage on stdout as unreadable output', async () => {
    expect((await call('garbage')).error).toMatch(/unreadable output/);
  });
});
