import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CliProvider from '../src/provider/cli.js';
import { catalogModel, snapshotFile } from './oracleFixture.js';

const stub = path.join(import.meta.dirname, 'fixtures/stub-cli.mjs');

const provider = (config: Record<string, unknown> = {}) =>
  new CliProvider({ config: { cli: stub, ...config } });

const call = (
  question: string,
  vars: Record<string, string> = { model: 'm/one' },
  config: Record<string, unknown> = {},
) => provider(config).callApi(question, { vars });

afterEach(() => vi.unstubAllEnvs());

describe('the placeholders of a question', () => {
  const catalog = () => {
    const file = snapshotFile([
      catalogModel('a/x', 1000, true, 1, 3),
      catalogModel('b/y', 1000, true, 100, 110),
      catalogModel('f/one:free', 1000, true, 0, 0),
    ]);
    vi.stubEnv('EVAL_CATALOG', file);
  };

  it('are replaced from the snapshot of the run before the CLI starts, and the models under test are skipped', async () => {
    catalog();
    vi.stubEnv('EVAL_MODELS', 'f/one:free,m/one');
    const result = await call('echo {flagship_model} {free_model}', {
      model: 'm/one',
    });
    expect(result.error).toBe(
      'The snapshot holds no free model besides the models under test (f/one:free, m/one).',
    );
    vi.stubEnv('EVAL_MODELS', 'm/one');
    const resolved = await call('echo {flagship_model} {free_model}');
    const argv = JSON.parse((resolved.output as { answer: string }).answer);
    expect(argv[4]).toBe('echo b/y f/one:free');
  });

  it('give every repeat on every model the same slug: a case that runs 10 times on 2 models asks about one model', async () => {
    catalog();
    vi.stubEnv('EVAL_MODELS', 'm/one,m/two');
    const asked = await Promise.all(
      ['m/one', 'm/two'].flatMap((model) =>
        Array.from({ length: 10 }, async () => {
          const result = await call('echo {flagship_model} {free_model}', {
            model,
          });
          const argv = JSON.parse((result.output as { answer: string }).answer);
          return argv[4] as string;
        }),
      ),
    );
    expect(asked).toHaveLength(20);
    expect(new Set(asked)).toEqual(new Set(['echo b/y f/one:free']));
  });

  it('name the models under test as they were given, without the empty ones, or none when none were', async () => {
    catalog();
    vi.stubEnv('EVAL_MODELS', 'f/one:free,,m/one,');
    expect((await call('echo {free_model}')).error).toBe(
      'The snapshot holds no free model besides the models under test (f/one:free, m/one).',
    );
    vi.stubEnv('EVAL_MODELS', '');
    expect((await call('echo {free_model}')).error).toBeUndefined();
    vi.stubEnv(
      'EVAL_CATALOG',
      snapshotFile([catalogModel('a/x', 1, true, 1, 1)]),
    );
    vi.stubEnv('EVAL_MODELS', undefined as never);
    expect((await call('echo {free_model}')).error).toBe(
      'The snapshot holds no free model besides the models under test ().',
    );
  });

  it('end the call with an error when the snapshot cannot be read', async () => {
    vi.stubEnv('EVAL_CATALOG', '/nonexistent/catalog.json');
    const result = await call('echo {free_model}');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/catalog\.json|snapshot/i);
  });

  it('leave a prompt with another {name} alone', async () => {
    const result = await call('echo {other}');
    const argv = JSON.parse((result.output as { answer: string }).answer);
    expect(argv[4]).toBe('echo {other}');
  });

  it('end the call with an error that names the snapshot when the run has none', async () => {
    vi.stubEnv('EVAL_CATALOG', '');
    const result = await call('echo {free_model}');
    expect(result.output).toBeUndefined();
    expect(result.error).toBe(
      'The prompt holds the placeholder {free_model}, and the run has no snapshot: EVAL_CATALOG names none.',
    );
  });
});

describe('a successful run', () => {
  it('returns the success object the CLI wrote as the output', async () => {
    const result = await call('ok');
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({
      question: 'ok',
      answer: 'GOOD answer',
      success: true,
      model: 'm/one',
    });
  });

  it('starts the CLI with --json --model and -q, nothing else', async () => {
    const result = await call('echo hi', { model: 'a/b:free' });
    const argv = JSON.parse((result.output as { answer: string }).answer);
    expect(argv).toEqual(['--json', '--model', 'a/b:free', '-q', 'echo hi']);
  });

  it('hands a question with shell syntax over unchanged and runs no command', async () => {
    const question = 'echo "quoted" $(id) ; touch /tmp/never\nsecond line `x`';
    const result = await call(question);
    const argv = JSON.parse((result.output as { answer: string }).answer);
    expect(argv[4]).toBe(question);
  });

  it('hands over any question unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary' }).filter((text) => !text.includes('\0')),
        async (text) => {
          const result = await call(`echo${text}`);
          const argv = JSON.parse((result.output as { answer: string }).answer);
          expect(argv[4]).toBe(`echo${text}`);
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('the cost and the tokens', () => {
  it('reports the cost and the token usage of the run', async () => {
    const result = await call('ok');
    expect(result.cost).toBe(0.01);
    expect(result.tokenUsage).toEqual({ prompt: 10, completion: 5, total: 15 });
  });

  it('leaves the cost out, and does not make it 0, when the CLI reported none', async () => {
    const result = await call('nocost');
    expect(result.error).toBeUndefined();
    expect('cost' in result).toBe(false);
    expect(result.tokenUsage).toEqual({ prompt: 10, completion: 5, total: 15 });
  });
});

describe('the model', () => {
  const marker = () =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evals-mark-')), 'mark');

  it.each([
    ['missing', {}],
    ['empty', { model: '' }],
  ])(
    'fails with an error that names vars.model when it is %s',
    async (_, vars) => {
      const mark = marker();
      vi.stubEnv('STUB_MARK', mark);
      const result = await call('ok', vars);
      expect(result.error).toMatch(/vars\.model/);
      expect(fs.existsSync(mark)).toBe(false);
    },
  );

  it('does not fall back on OPENROUTER_MODEL', async () => {
    const mark = marker();
    vi.stubEnv('STUB_MARK', mark);
    vi.stubEnv('OPENROUTER_MODEL', 'env/model');
    const result = await call('ok', {});
    expect(result.error).toMatch(/vars\.model/);
    expect(fs.existsSync(mark)).toBe(false);
  });
});

describe('the outcomes of a CLI run that did not succeed', () => {
  it('turns a non-zero exit into an error with the exit code and the stderr text', async () => {
    const result = await call('exit1');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/exit(ed)?.*1/i);
    expect(result.error).toContain('boom');
  });

  it('turns stdout that is not JSON into an error that says so', async () => {
    const result = await call('garbage');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/unreadable/i);
  });

  it('turns a JSON object without success: true into the same error', async () => {
    const result = await call('nosuccess');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/unreadable/i);
  });

  it('kills a CLI that outlives the timeout and names the timeout', async () => {
    const result = await call('sleep', { model: 'm/one' }, { timeoutMs: 300 });
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/timed out after 300 ms/i);
  });
});
