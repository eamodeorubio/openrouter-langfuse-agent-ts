import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_REPEAT, parseRunArgs, promptfooArgs } from '../src/runner.js';

const root = path.resolve(import.meta.dirname, '..');
const configFile = path.join(root, 'promptfooconfig.yaml');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');

interface Case {
  description: string;
  vars: { model?: string[]; question: string };
  metadata: { id: string } & Record<string, unknown>;
  assert?: { metric: string; value: string }[];
}

const config = parse(fs.readFileSync(configFile, 'utf8')) as {
  providers: { id: string }[];
  defaultTest: {
    vars: { model: string[] };
    assert: { metric: string; value: string }[];
  };
  tests: Case[];
};

describe('the model matrix', () => {
  const models = config.defaultTest.vars.model;

  it('holds the two models, once, for every case', () => {
    expect(models).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'anthropic/claude-haiku-5.5',
    ]);
    for (const test of config.tests) {
      expect(test.vars.model, test.metadata.id).toBeUndefined();
    }
  });

  it('has distinct slugs that are not aliases', () => {
    expect(new Set(models).size).toBe(2);
    for (const slug of models) {
      expect(slug).not.toMatch(/latest/i);
      expect(slug.startsWith('~')).toBe(false);
      expect(slug).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+(:[a-z]+)?$/);
    }
  });
});

describe('the cases', () => {
  it('say in one line what they test, and keep their code in metadata.id', () => {
    for (const test of config.tests) {
      expect(test.description).not.toContain('\n');
      expect(test.description.split(/\s+/).length).toBeGreaterThan(4);
      expect(test.description).not.toBe(test.metadata.id);
      expect(test.metadata.id).toMatch(/^[A-Z]\d+$/);
    }
  });
});

describe('the run', () => {
  it('runs every case ten times and never reads the cache', () => {
    expect(DEFAULT_REPEAT).toBe(10);
    const options = parseRunArgs([]);
    expect(typeof options).toBe('object');
    const args = promptfooArgs(options as Exclude<typeof options, string>);
    expect(args).toContain('--no-cache');
    expect(
      args.slice(args.indexOf('--repeat'), args.indexOf('--repeat') + 2),
    ).toEqual(['--repeat', '10']);
  });

  it('writes the results as JSON under the ignored results directory by default', () => {
    const options = parseRunArgs(
      [],
      () => new Date('2026-11-13T21:30:00.123Z'),
    );
    expect(options).toMatchObject({
      out: path.join(root, 'results', '2026-11-13T21-30-00-123Z'),
    });
  });

  it.each([
    [['--repeat', '0'], /--repeat/],
    [['--repeat', 'many'], /--repeat/],
    [['--bogus'], /Unexpected argument: --bogus/],
    [['--repeat'], /Unexpected argument: --repeat/],
  ])('rejects the arguments %j with a message', (argv, message) => {
    expect(parseRunArgs(argv)).toMatch(message);
  });

  it('keeps the eval script on the runner', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.eval).toBe('tsx src/run.ts');
    expect(pkg.scripts.test).toBe('vitest run');
  });
});

describe('the config', () => {
  it('holds no key and reads none from a file', () => {
    const text = fs.readFileSync(configFile, 'utf8');
    expect(text).not.toMatch(/sk-or-|sk-[a-z0-9]{20,}/i);
    for (const line of text.split('\n').filter((l) => /apiKey/i.test(l))) {
      expect(line).toMatch(/\{\{\s*env\./);
    }
  });

  it('declares the case A1 with what it needs', () => {
    const a1 = config.tests.find((test) => test.metadata.id === 'A1');
    expect(a1?.vars.question).toMatch(/openai\/gpt-oss-20b/);
    expect(a1?.metadata).toEqual({
      id: 'A1',
      needsLookup: true,
      askedModel: 'openai/gpt-oss-20b',
      askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
    });
    expect(a1?.assert?.map((a) => a.metric).sort()).toEqual([
      'wrong-search',
      'wrong-value',
    ]);
  });

  it('gives every case its own code, so that no two cells merge', () => {
    const ids = config.tests.map((test) => test.metadata.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every universal check with its class', () => {
    expect(config.defaultTest.assert.map((a) => a.metric).sort()).toEqual([
      'invented-data',
      'memory-answer',
      'run-failed',
    ]);
  });

  it('starts the provider from the source tree', () => {
    expect(config.providers[0]?.id).toBe('file://src/provider/cli.ts');
  });
});

describe('the config, run for real against a stub CLI', () => {
  let out: string;
  let result: ReturnType<typeof spawnSync>;

  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-config-'));
    result = spawnSync(
      path.join(root, 'node_modules/.bin/tsx'),
      [
        path.join(root, 'src/run.ts'),
        '--repeat',
        '2',
        '--k',
        '1,2',
        '--out',
        out,
      ],
      { cwd: root, encoding: 'utf8', env: { ...process.env, EVAL_CLI: stub } },
    );
  });

  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it('loads every check, and each of the two models runs the case twice', () => {
    expect(result.status, String(result.stderr)).toBe(0);
    const saved = JSON.parse(
      fs.readFileSync(path.join(out, 'results.json'), 'utf8'),
    );
    expect(saved.results.results).toHaveLength(4);
    const errors = saved.results.results.filter(
      (r: { failureReason: number }) => r.failureReason === 2,
    );
    expect(errors).toHaveLength(0);
  });

  it('reads what the case declares: the stub holds another model, so the search is wrong', () => {
    const stdout = String(result.stdout);
    for (const model of config.defaultTest.vars.model) {
      expect(stdout).toContain(model);
    }
    expect(stdout).toMatch(/A1\s+n=2\s+c=0\s+err=0/);
    expect(stdout).toContain('wrong-search=2');
    // The stub made a lookup and its answer names no invented model.
    expect(stdout).not.toContain('memory-answer');
    expect(stdout).not.toContain('invented-data');
    expect(stdout).not.toContain('run-failed');
  });
});
