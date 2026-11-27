import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRuns } from '../src/report/results.js';
import { serveCatalog } from './catalogServer.js';
import { serveJev } from './jevServer.js';
import { type Finished, runTsx } from './runTsx.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');
const FLAG = '--skip-weightless-rubrics';

/** What one run left: how it ended, what Jev was asked, and the folder of its results. */
interface Outcome {
  done: Finished;
  /** Requests that reached Jev during the run. */
  asked: number;
  out: string;
  /** The judge metrics the report prints a line for. */
  judgeLines: string[];
}

describe('--skip-weightless-rubrics, end to end, with a stub CLI and a loopback Jev', () => {
  let catalog: Awaited<ReturnType<typeof serveCatalog>>;
  let jev: Awaited<ReturnType<typeof serveJev>>;
  const dirs: string[] = [];

  /** Runs one fixture config, one after the other: every run uses the promptfoo state directory of the package. */
  const runWith = async (variant: string, flag: boolean): Promise<Outcome> => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-skip-'));
    dirs.push(out);
    const before = jev.requests.length;
    const done = await runTsx(
      [
        path.join(root, 'src/run.ts'),
        ...[
          '--config',
          path.join(root, `test/fixtures/skip-rubrics/${variant}.config.yaml`),
        ],
        ...['--repeat', '2', '--k', '1,2', '--out', out],
        ...(flag ? [FLAG] : []),
      ],
      {
        EVAL_CLI: stub,
        EVAL_CATALOG_URL: catalog.url,
        EVAL_JUDGE_URL: jev.url,
        OPENROUTER_API_KEY: 'DUMMY-KEY',
      },
    );
    return {
      done,
      asked: jev.requests.length - before,
      out,
      // A judge line of the report: the rubric, its rate and its unscored runs.
      judgeLines: [
        ...new Set(
          [
            ...done.stdout.matchAll(
              /^\s+(judge-[a-z-]+) \S+ \(\d+ unscored\)$/gm,
            ),
          ].map((match) => match[1] as string),
        ),
      ].sort(),
    };
  };

  let kept: Outcome;
  let skipped: Outcome;
  let oneWeighted: Outcome;
  let noWeight: Outcome;

  beforeAll(async () => {
    catalog = await serveCatalog();
    jev = await serveJev({ noul: 0.8 });
    kept = await runWith('all-zero', false);
    skipped = await runWith('all-zero', true);
    oneWeighted = await runWith('one-weighted', true);
    noWeight = await runWith('no-weight', true);
  }, 240_000);

  afterAll(async () => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    await catalog.close();
    await jev.close();
  });

  /** The n, the passes c and the provider errors of each case, as the report counts them. */
  const cells = (outcome: Outcome) => {
    const file = path.join(outcome.out, 'results.json');
    const runs = readRuns(JSON.parse(fs.readFileSync(file, 'utf8'))).runs;
    const counts: Record<string, { n: number; c: number; errors: number }> = {};
    for (const run of runs) {
      const cell = counts[run.caseName] ?? { n: 0, c: 0, errors: 0 };
      counts[run.caseName] = cell;
      cell.n++;
      if (run.passed) cell.c++;
      if (run.error) cell.errors++;
    }
    return counts;
  };

  it('asks Jev once for each rubric of each run, and reports each, without the flag', () => {
    expect(kept.done.status, kept.done.stderr).toBe(0);
    // Case a lists two rubrics, b and c one each, two repeats each.
    expect(kept.asked).toBe(8);
    expect(kept.judgeLines).toEqual(['judge-relevance', 'judge-usefulness']);
  });

  it('sends no request to Jev and reports no judge line, with the flag and every rubric at weight 0', () => {
    expect(skipped.done.status, skipped.done.stderr).toBe(0);
    expect(skipped.asked).toBe(0);
    expect(skipped.judgeLines).toEqual([]);
  });

  it('keeps a rubric at weight 1 and removes the one at weight 0 beside it', () => {
    expect(oneWeighted.done.status, oneWeighted.done.stderr).toBe(0);
    // Only case a lists judge-relevance, two repeats.
    expect(oneWeighted.asked).toBe(2);
    expect(oneWeighted.judgeLines).toEqual(['judge-relevance']);
  });

  it('keeps a rubric with no weight key', () => {
    expect(noWeight.done.status, noWeight.done.stderr).toBe(0);
    expect(noWeight.asked).toBe(2);
    expect(noWeight.judgeLines).toEqual(['judge-grounding']);
  });

  it('judges the same answers the same way with and without the flag', () => {
    expect(cells(skipped)).toEqual(cells(kept));
    // Case c fails its check in both runs, so a skipped run that always passed would differ.
    expect(cells(kept)).toEqual({
      a: { n: 2, c: 2, errors: 0 },
      b: { n: 2, c: 2, errors: 0 },
      c: { n: 2, c: 0, errors: 0 },
    });
  });

  it('keeps the javascript checks of defaultTest when it removes the rubrics', () => {
    const file = path.join(skipped.out, 'results.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      results: {
        results: {
          gradingResult: {
            componentResults: { assertion: { metric: string } }[];
          };
        }[];
      };
    };
    for (const result of saved.results.results) {
      expect(
        result.gradingResult.componentResults.map((c) => c.assertion.metric),
      ).toEqual(['wrong-value']);
    }
  });

  it('says so in target.txt and on the first line of the report, and only with the flag', () => {
    for (const flagged of [skipped, oneWeighted, noWeight]) {
      const target = fs.readFileSync(
        path.join(flagged.out, 'target.txt'),
        'utf8',
      );
      expect(target.endsWith(', rubrics of weight 0 skipped')).toBe(true);
      expect(flagged.done.stdout.split('\n')[0]).toMatch(
        /^target: .*, rubrics of weight 0 skipped$/,
      );
    }
    const plain = fs.readFileSync(path.join(kept.out, 'target.txt'), 'utf8');
    expect(plain).not.toContain('skipped');
    expect(kept.done.stdout.split('\n')[0]).not.toContain('skipped');
  });
});
