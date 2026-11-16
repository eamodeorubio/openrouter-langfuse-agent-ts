import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveCatalog } from './catalogServer.js';
import { type Finished, runTsx } from './runTsx.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');
const config = path.join(root, 'test/fixtures/model-filter.config.yaml');

const savedModels = (out: string): string[] =>
  JSON.parse(
    fs.readFileSync(path.join(out, 'results.json'), 'utf8'),
  ).results.results.map((r: { vars: { model: string } }) => r.vars.model);

describe('the --model filter, end to end, with a stub CLI', () => {
  let catalog: Awaited<ReturnType<typeof serveCatalog>>;
  const dirs: string[] = [];
  const outDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-filter-'));
    dirs.push(dir);
    return dir;
  };
  const runEval = (extra: string[], out: string): Promise<Finished> =>
    runTsx(
      [
        path.join(root, 'src/run.ts'),
        ...['--config', config, '--repeat', '2', '--k', '1,2', '--out', out],
        ...extra,
      ],
      {
        EVAL_CLI: stub,
        EVAL_CATALOG_URL: catalog.url,
        OPENROUTER_API_KEY: 'DUMMY-KEY',
      },
    );

  let narrowed: Finished;
  let narrowedOut: string;
  let whole: Finished;
  let wholeOut: string;

  beforeAll(async () => {
    catalog = await serveCatalog();
    narrowedOut = outDir();
    wholeOut = outDir();
    // One after the other: both runs use the promptfoo state directory of the package.
    narrowed = await runEval(['--model', 'm/two'], narrowedOut);
    whole = await runEval([], wholeOut);
  });

  afterAll(async () => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    await catalog.close();
  });

  it('asks every case of the one model that --model names, and of no other', () => {
    expect(narrowed.status, narrowed.stderr).toBe(0);
    expect(savedModels(narrowedOut)).toEqual(Array(4).fill('m/two'));
    expect(narrowed.stdout).toContain('m/two');
    expect(narrowed.stdout).not.toContain('m/one');
  });

  it('names the models on the first line of the report of a narrowed run', () => {
    expect(narrowed.stdout.split('\n')[0]).toMatch(
      /^target: local build \(.+\), models: m\/two$/,
    );
  });

  it('asks both models of the config when there is no --model, and names no models', () => {
    expect(whole.status, whole.stderr).toBe(0);
    expect([...new Set(savedModels(wholeOut))].sort()).toEqual([
      'm/one',
      'm/two',
    ]);
    expect(savedModels(wholeOut)).toHaveLength(8);
    expect(whole.stdout.split('\n')[0]).not.toContain('models:');
  });

  it('refuses an unknown model with exit 3, before any request and any result', async () => {
    const out = outDir();
    const before = catalog.requests();
    const refused = await runEval(['--model', 'x/none'], out);
    expect(refused.status).toBe(3);
    expect(refused.stderr).toContain('x/none');
    expect(refused.stderr).toContain('m/one');
    expect(refused.stderr).toContain('m/two');
    expect(catalog.requests()).toBe(before);
    expect(fs.existsSync(path.join(out, 'results.json'))).toBe(false);
  });
});
