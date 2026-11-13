import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveCatalog } from './catalogServer.js';
import { runTsx } from './runTsx.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');
const config = path.join(root, 'test/fixtures/harness.config.yaml');
const runEval = (url: string, out: string, mark: string) =>
  runTsx(
    [
      path.join(root, 'src/run.ts'),
      '--config',
      config,
      '--repeat',
      '1',
      '--k',
      '1',
      '--out',
      out,
    ],
    { EVAL_CLI: stub, EVAL_CATALOG_URL: url, STUB_MARK: mark },
  );

describe('the catalog snapshot of an eval run', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-oracle-'));
    dirs.push(dir);
    return dir;
  };

  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('when the model list is reachable', () => {
    let out: string;
    let mark: string;
    let result: Awaited<ReturnType<typeof runEval>>;
    let server: Awaited<ReturnType<typeof serveCatalog>>;

    beforeAll(async () => {
      server = await serveCatalog(200);
      out = tmp();
      mark = path.join(tmp(), 'mark');
      result = await runEval(server.url, out, mark);
    });

    afterAll(() => server.close());

    it('runs, and saves the snapshot with the time it was fetched', () => {
      expect(result.status, result.stderr).toBe(0);
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'),
      );
      expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
      expect(snapshot.models).toHaveLength(6);
      expect(
        snapshot.models.find(
          (m: { id: string }) => m.id === 'openai/gpt-oss-20b',
        ),
      ).toEqual({
        id: 'openai/gpt-oss-20b',
        contextLength: 131072,
        supportedParameters: expect.arrayContaining(['tools']),
        inputModalities: ['text'],
        outputModalities: ['text'],
        inputPrice: 0.03,
        outputPrice: 0.13,
      });
    });

    it('takes the snapshot before the first CLI start, and tells the run where it is', () => {
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'),
      );
      const [first] = fs.readFileSync(mark, 'utf8').trim().split('\n');
      const [, startedAt, catalog] = (first ?? '').split(' ');
      expect(Number(startedAt)).toBeGreaterThanOrEqual(
        Date.parse(snapshot.fetchedAt),
      );
      expect(catalog).toBe(path.join(out, 'catalog.json'));
    });
  });

  describe('when the model list cannot be fetched', () => {
    it('stops before any case, says why and exits non-zero', async () => {
      const server = await serveCatalog(500);
      const out = tmp();
      const mark = path.join(tmp(), 'mark');
      const result = await runEval(server.url, out, mark);
      await server.close();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/catalog/i);
      expect(result.stderr).toContain('500');
      expect(result.stdout).toBe('');
      expect(fs.existsSync(mark)).toBe(false);
      expect(fs.existsSync(path.join(out, 'results.json'))).toBe(false);
    });
  });
});
