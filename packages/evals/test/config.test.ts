import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readCase } from '../src/checks/caseSpec.js';
import { DEFAULT_REPEAT, parseRunArgs, promptfooArgs } from '../src/runner.js';
import { serveCatalog } from './catalogServer.js';
import { type Finished, runTsx } from './runTsx.js';

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
  tests: string;
};

/** The cases of the files under `cases/`, each with the family its file is named for. */
const cases: (Case & { family: string })[] = fs
  .readdirSync(path.join(root, 'cases'))
  .filter((file) => file.endsWith('.yaml'))
  .sort()
  .flatMap((file) =>
    (
      parse(fs.readFileSync(path.join(root, 'cases', file), 'utf8')) as Case[]
    ).map((test) => ({ ...test, family: file.replace(/\.yaml$/, '') })),
  );

describe('the model matrix', () => {
  const models = config.defaultTest.vars.model;

  it('holds the two models, once, for every case', () => {
    expect(models).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'anthropic/claude-haiku-5.5',
    ]);
    for (const test of cases) {
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

describe('the files of cases', () => {
  it('are all the tests of the config, which names them by a glob', () => {
    expect(config.tests).toBe('file://cases/*.yaml');
    expect(cases.length).toBeGreaterThan(0);
  });

  it('give every case a set, and the core set is the three cases of the core', () => {
    for (const test of cases) {
      expect(['core', 'full'], test.metadata.id).toContain(test.metadata.set);
    }
    expect(
      cases
        .filter((test) => test.metadata.set === 'core')
        .map((test) => test.metadata.id),
    ).toEqual([
      'calculation/given-prices',
      'lookup/known-model',
      'search/cheapest-blended',
    ]);
  });
});

describe('the search cases of the full set', () => {
  const byId = (id: string) => cases.find((test) => test.metadata.id === id);
  const metrics = (id: string) =>
    (byId(id)?.assert ?? []).map((a) => a.metric).sort();

  it('are in cases/search.yaml, tagged full, and read by the case contract', () => {
    for (const id of [
      'search/cheapest-input',
      'search/image-input',
      'search/none-exists',
      'search/count',
      'search/single-search',
    ]) {
      expect(byId(id)?.family, id).toBe('search');
      expect(readCase({ test: byId(id) }).set, id).toBe('full');
      expect(readCase({ test: byId(id) }).needsLookup, id).toBe(true);
    }
  });

  it('search/cheapest-input asks for the lowest input price with 200,000 tokens and tools', () => {
    const spec = readCase({ test: byId('search/cheapest-input') });
    expect(byId('search/cheapest-input')?.vars.question).toBe(
      'Which paid model on OpenRouter has the lowest input price among models with at least 200,000 tokens of context that support tool calling?',
    );
    expect(spec.oracle).toEqual({
      query: 'cheapest-input',
      params: { minContext: 200000, supportedParameters: ['tools'] },
    });
    expect(spec.search).toEqual({
      min_context_length: 200000,
      supported_parameters: ['tools'],
    });
    expect(metrics('search/cheapest-input')).toEqual([
      'wrong-answer',
      'wrong-search',
    ]);
  });

  it('search/image-input asks for the lowest input price among models that accept images', () => {
    const spec = readCase({ test: byId('search/image-input') });
    expect(byId('search/image-input')?.vars.question).toBe(
      'Which paid model that accepts image input has the lowest input price?',
    );
    expect(spec.oracle).toEqual({
      query: 'cheapest-input',
      params: { inputModalities: ['image'] },
    });
    expect(spec.search).toEqual({ input_modalities: ['image'] });
    expect(metrics('search/image-input')).toEqual([
      'wrong-answer',
      'wrong-search',
    ]);
  });

  it('search/none-exists asks for a model that does not exist, and expects the answer to say so', () => {
    const spec = readCase({ test: byId('search/none-exists') });
    expect(byId('search/none-exists')?.vars.question).toBe(
      'Find a model with at least 2 million tokens of context that can output images and costs less than 0.01 USD per million input tokens.',
    );
    expect(spec.oracle).toEqual({
      query: 'matching',
      params: {
        minContext: 2000000,
        outputModalities: ['image'],
        maxInputPrice: 0.01,
      },
    });
    expect(spec.search).toEqual({
      min_context_length: 2000000,
      output_modalities: ['image'],
    });
    expect(metrics('search/none-exists')).toEqual([
      'phantom-match',
      'wrong-search',
    ]);
  });

  it('search/count asks how many models support tools with 1 million tokens, and expects the count', () => {
    const spec = readCase({ test: byId('search/count') });
    expect(byId('search/count')?.vars.question).toBe(
      'How many models on OpenRouter support tool calling and have a context window of at least 1 million tokens?',
    );
    expect(spec.oracle).toEqual({
      query: 'matching',
      params: { minContext: 1000000, supportedParameters: ['tools'] },
    });
    expect(spec.search).toEqual({
      min_context_length: 1000000,
      supported_parameters: ['tools'],
    });
    expect(metrics('search/count')).toEqual(['wrong-search', 'wrong-value']);
  });

  it('search/single-search expects one sorted search that does the filtering on the server', () => {
    const spec = readCase({ test: byId('search/single-search') });
    expect(byId('search/single-search')?.vars.question).toBe(
      'Which is the cheapest model with at least 200,000 tokens of context that supports tools?',
    );
    expect(spec.oracle).toBeUndefined();
    expect(spec.search).toEqual({
      min_context_length: 200000,
      supported_parameters: ['tools'],
      sort: 'pricing-low-to-high',
    });
    expect(metrics('search/single-search')).toEqual([
      'wasteful-search',
      'wrong-answer',
      'wrong-search',
    ]);
  });
});

describe('the core set', () => {
  it('holds the cases of the files, in the order of the files and then of each file', () => {
    expect(cases.map((test) => test.metadata.id)).toEqual([
      'calculation/given-prices',
      'lookup/known-model',
      'search/cheapest-blended',
      'search/cheapest-input',
      'search/image-input',
      'search/none-exists',
      'search/count',
      'search/single-search',
    ]);
  });
});

describe('the declarations of the cases', () => {
  it('are all known and of the right kind, so that no typo can turn a check into a pass', () => {
    for (const test of cases) {
      expect(() => readCase({ test }), test.metadata.id).not.toThrow();
      expect(readCase({ test }).id).toBe(test.metadata.id);
    }
  });
});

describe('the cases', () => {
  it('say in one line what they test, and keep their code in metadata.id', () => {
    for (const test of cases) {
      expect(test.description).not.toContain('\n');
      expect(test.description.split(/\s+/).length).toBeGreaterThan(4);
      expect(test.description).not.toBe(test.metadata.id);
      expect(test.metadata.id).toMatch(
        /^[a-z]+(-[a-z]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
      );
      expect(test.metadata.id.split('/')[0]).toBe(test.family);
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

  it('declares the case lookup/known-model with what it needs', () => {
    const a1 = cases.find((test) => test.metadata.id === 'lookup/known-model');
    expect(a1?.vars.question).toMatch(/openai\/gpt-oss-20b/);
    expect(a1?.metadata).toEqual({
      id: 'lookup/known-model',
      set: 'core',
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
    const ids = cases.map((test) => test.metadata.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares the case calculation/given-prices: the prices are in the question, so no lookup, and the cost is 3', () => {
    const b7 = cases.find(
      (test) => test.metadata.id === 'calculation/given-prices',
    );
    expect(b7?.vars.question).toMatch(/0\.50 USD per million input tokens/);
    expect(b7?.vars.question).toMatch(/1\.50 USD per million output tokens/);
    expect(b7?.vars.question).toMatch(
      /3 million input tokens and 1 million output tokens/,
    );
    expect(b7?.metadata).toEqual({
      id: 'calculation/given-prices',
      set: 'core',
      needsLookup: false,
      needsArithmetic: true,
      expectedCost: 3,
    });
    expect(0.5 * 3 + 1.5 * 1).toBe(3);
    expect(b7?.assert?.map((a) => a.metric).sort()).toEqual([
      'arithmetic-in-head',
      'needless-lookup',
      'wrong-value',
    ]);
  });

  it('declares the case search/cheapest-blended: the cheapest paid model with 200000 tokens and tools, at a mix of 3', () => {
    const c1 = cases.find(
      (test) => test.metadata.id === 'search/cheapest-blended',
    );
    expect(c1?.vars.question).toMatch(/200,000 tokens of context/);
    expect(c1?.vars.question).toMatch(/3 input tokens for every output token/);
    expect(c1?.metadata).toEqual({
      id: 'search/cheapest-blended',
      set: 'core',
      needsLookup: true,
      oracle: {
        query: 'cheapest-blended',
        params: { minContext: 200000, supportedParameters: ['tools'], mix: 3 },
      },
      search: { min_context_length: 200000, supported_parameters: ['tools'] },
    });
    expect(c1?.assert?.map((a) => a.metric).sort()).toEqual([
      'wrong-answer',
      'wrong-search',
    ]);
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
  let result: Finished;
  let catalog: Awaited<ReturnType<typeof serveCatalog>>;

  beforeAll(async () => {
    catalog = await serveCatalog();
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-config-'));
    result = await runTsx(
      [
        path.join(root, 'src/run.ts'),
        '--repeat',
        '2',
        '--k',
        '1,2',
        '--out',
        out,
      ],
      { EVAL_CLI: stub, EVAL_CATALOG_URL: catalog.url },
    );
  });

  afterAll(async () => {
    fs.rmSync(out, { recursive: true, force: true });
    await catalog.close();
  });

  it('loads every check, and each of the two models runs each of the three cases twice', () => {
    expect(result.status, String(result.stderr)).toBe(0);
    const saved = JSON.parse(
      fs.readFileSync(path.join(out, 'results.json'), 'utf8'),
    );
    expect(saved.results.results).toHaveLength(12);
    const errors = saved.results.results.filter(
      (r: { failureReason: number }) => r.failureReason === 2,
    );
    expect(errors).toHaveLength(0);
  });

  it('reads what each case declares, and the snapshot of the run', () => {
    const stdout = String(result.stdout);
    for (const model of config.defaultTest.vars.model) {
      expect(stdout).toContain(model);
    }
    // The stub answers every question with a lookup of a/b and the words "GOOD answer".
    // lookup/known-model: the model it was asked about is not in its lookups.
    expect(stdout).toMatch(/lookup\/known-model\s+n=2\s+c=0\s+err=0/);
    expect(stdout).toMatch(
      /lookup\/known-model[^\n]*\n\s+failed: wrong-search=2\n/,
    );
    // calculation/given-prices: it looked data up that the question held, did no arithmetic and stated no cost.
    expect(stdout).toMatch(/calculation\/given-prices\s+n=2\s+c=0\s+err=0/);
    expect(stdout).toMatch(
      /calculation\/given-prices[^\n]*\n\s+failed: arithmetic-in-head=2 needless-lookup=2 wrong-value=2\n/,
    );
    // search/cheapest-blended: no lookup surfaced the one acceptable model of the snapshot.
    expect(stdout).toMatch(/search\/cheapest-blended\s+n=2\s+c=0\s+err=0/);
    expect(stdout).toMatch(
      /search\/cheapest-blended[^\n]*\n\s+failed: wrong-search=2\n/,
    );
    // The stub made lookups and its answer names no invented model.
    const failedLines = stdout
      .split('\n')
      .filter((line) => line.includes('failed:'))
      .join('\n');
    expect(failedLines).not.toContain('memory-answer');
    expect(failedLines).not.toContain('invented-data');
    expect(failedLines).not.toContain('run-failed');
    expect(failedLines).not.toContain('wrong-answer');
    // The block by error class counts what each class judged.
    expect(stdout).toContain('by error class');
    expect(stdout).toMatch(/wrong-search\s+judged=\d+\s+passed=0\s+failed=\d+/);
    expect(fs.existsSync(path.join(out, 'catalog.json'))).toBe(true);
  });
});

describe('the full set, run for real against a stub CLI', () => {
  let out: string;
  let result: Finished;
  let catalog: Awaited<ReturnType<typeof serveCatalog>>;

  beforeAll(async () => {
    catalog = await serveCatalog();
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-full-'));
    result = await runTsx(
      [
        path.join(root, 'src/run.ts'),
        '--set',
        'full',
        '--repeat',
        '1',
        '--k',
        '1',
        '--out',
        out,
      ],
      { EVAL_CLI: stub, EVAL_CATALOG_URL: catalog.url },
    );
  });

  afterAll(async () => {
    fs.rmSync(out, { recursive: true, force: true });
    await catalog.close();
  });

  it('asks every case, each of the two models once', () => {
    expect(result.status, String(result.stderr)).toBe(0);
    const saved = JSON.parse(
      fs.readFileSync(path.join(out, 'results.json'), 'utf8'),
    );
    expect(saved.results.results).toHaveLength(cases.length * 2);
  });

  it('names the class each search case fails when the stub never searches', () => {
    const stdout = String(result.stdout);
    const failed = (id: string) =>
      new RegExp(
        `${id.replace('/', '\\/')}[^\\n]*\\n\\s+failed: ([^\\n]*)\\n`,
      ).exec(stdout)?.[1];
    expect(failed('search/cheapest-input')).toBe('wrong-search=1');
    expect(failed('search/image-input')).toBe('wrong-search=1');
    expect(failed('search/none-exists')).toBe('wrong-search=1');
    expect(failed('search/count')).toBe('wrong-search=1');
    expect(failed('search/single-search')).toBe(
      'wasteful-search=1 wrong-search=1',
    );
  });
});
