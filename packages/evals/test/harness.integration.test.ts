import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveCatalog } from './catalogServer.js';
import { type Finished, runTsx } from './runTsx.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');
const config = path.join(root, 'test/fixtures/harness.config.yaml');
const DUMMY_KEY = 'DUMMY-KEY-do-not-leak-0123456789';

/** Every file under a directory, however deep. */
const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? filesUnder(path.join(dir, entry.name))
            : [path.join(dir, entry.name)],
        )
    : [];

let catalogUrl = '';

/** The bytes of a file, or nothing when it vanished or cannot be read. */
const readOrNothing = (file: string): Buffer | undefined => {
  try {
    return fs.readFileSync(file);
  } catch {
    return undefined;
  }
};

const runEval = (
  args: string[],
  env: Record<string, string> = {},
): Promise<Finished> =>
  runTsx([path.join(root, 'src/run.ts'), ...args], {
    EVAL_CLI: stub,
    EVAL_CATALOG_URL: catalogUrl,
    ...env,
  });

describe('the eval harness, end to end, with a stub CLI', () => {
  let out: string;
  let run: Finished;

  let catalog: Awaited<ReturnType<typeof serveCatalog>>;

  beforeAll(async () => {
    catalog = await serveCatalog();
    catalogUrl = catalog.url;
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-harness-'));
    run = await runEval(
      ['--config', config, '--repeat', '3', '--k', '1,3', '--out', out],
      { OPENROUTER_API_KEY: DUMMY_KEY },
    );
  });

  afterAll(async () => {
    fs.rmSync(out, { recursive: true, force: true });
    await catalog.close();
  });

  it('prints the report and exits 0 although runs failed and errored', () => {
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('m/one');
    expect(run.stdout).toContain('m/two');
  });

  it('runs every case three times with no cache and keeps the results as JSON', () => {
    const saved = JSON.parse(
      fs.readFileSync(path.join(out, 'results.json'), 'utf8'),
    );
    expect(saved.results.results).toHaveLength(15);
    expect(saved.runtimeOptions.cache).toBe(false);
    expect(saved.runtimeOptions.repeat).toBe(3);
  });

  it('reports a case that passed every time', () => {
    expect(run.stdout).toMatch(/ok\s+n=3\s+c=3\s+err=0/);
    expect(run.stdout).toMatch(/ok .*pass\^3=1\.0000/);
  });

  it('reports a failed check under its class', () => {
    expect(run.stdout).toMatch(/wrong\s+n=3\s+c=0\s+err=0/);
    expect(run.stdout).toContain('wrong-value=3');
  });

  it('counts a CLI that exits 1 as three failed runs, all errors', () => {
    expect(run.stdout).toMatch(/exit1\s+n=3\s+c=0\s+err=3/);
  });

  it('counts unreadable CLI output as errors', () => {
    expect(run.stdout).toMatch(/garbage\s+n=3\s+c=0\s+err=3/);
  });

  it('counts a case with no vars.model as errors that name the var', () => {
    expect(run.stdout).toMatch(/nomodel\s+n=3\s+c=0\s+err=3/);
    const saved = fs.readFileSync(path.join(out, 'results.json'), 'utf8');
    expect(saved).toContain('vars.model');
  });

  it('leaves the key out of every file the run wrote and of what it printed', () => {
    const written = [
      ...filesUnder(out),
      ...filesUnder(path.join(root, '.promptfoo')),
    ];
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) {
      // Other test files run promptfoo at the same time in the shared state
      // directory, and it rotates files there: one may be gone by now.
      const content = readOrNothing(file);
      if (content) expect(content.includes(DUMMY_KEY), file).toBe(false);
    }
    expect(run.stdout).not.toContain(DUMMY_KEY);
    expect(run.stderr).not.toContain(DUMMY_KEY);
  });

  it('stops before any run when the CLI is not built', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-nobuild-'));
    const result = await runEval(
      ['--config', config, '--repeat', '1', '--k', '1', '--out', empty],
      {
        EVAL_CLI: path.join(empty, 'missing.js'),
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/build/i);
    expect(fs.existsSync(path.join(empty, 'results.json'))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('exits non-zero and prints no report when promptfoo itself fails', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-broken-'));
    const result = await runEval([
      '--config',
      path.join(broken, 'absent.yaml'),
      '--repeat',
      '1',
      '--k',
      '1',
      '--out',
      broken,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    fs.rmSync(broken, { recursive: true, force: true });
  });
});
