import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { report } from '../src/report/cli.js';
import { readRuns } from '../src/report/results.js';
import { summarize } from '../src/report/summary.js';
import { many, type RunSpec, resultsFile, run } from './resultsFixture.js';

const summaryOf = (runs: ReturnType<typeof run>[], ks = [1], threshold = 0.7) =>
  summarize(readRuns(resultsFile(runs, threshold)).runs, ks, threshold);

const cellOf = (runs: ReturnType<typeof run>[], ks?: number[]) => {
  const [model] = summaryOf(runs, ks);
  const [cell] = model?.cells ?? [];
  if (!cell) throw new Error('no cell');
  return cell;
};

describe('cells', () => {
  it('count a provider error as a run that did not pass, and show the error count', () => {
    const cell = cellOf([
      ...many(6),
      ...many(3, { failed: ['wrong-value'] }),
      run({ error: true }),
    ]);
    expect(cell).toMatchObject({ n: 10, c: 6, errors: 1 });
  });

  it('are one case on one model', () => {
    const [one, two] = summaryOf([
      run({ model: 'm/one', caseName: 'A1' }),
      run({ model: 'm/one', caseName: 'B7' }),
      run({ model: 'm/two', caseName: 'A1' }),
    ]);
    expect(one?.model).toBe('m/one');
    expect(one?.cells.map((cell) => cell.case)).toEqual(['A1', 'B7']);
    expect(two?.model).toBe('m/two');
  });
});

describe('the estimators in a cell', () => {
  it('follow n and c for each k', () => {
    const cell = cellOf([...many(7), ...many(3, { failed: ['x'] })], [1, 3]);
    expect(cell.passAt[3]).toBeCloseTo(0.9917, 4);
    expect(cell.passHat[3]).toBeCloseTo(0.2917, 4);
    expect(cell.passAt[1]).toBeCloseTo(0.7, 10);
  });

  it('fail with a message that names n and k when k is above n', () => {
    expect(() => cellOf(many(4), [5])).toThrow(/n=4.*k=5/);
  });
});

describe('model rows', () => {
  it('hold the mean of the estimators of its cells, each cell with equal weight', () => {
    const [model] = summaryOf(
      [
        ...many(5, { caseName: 'A1' }),
        ...many(5, { caseName: 'A1', failed: ['x'] }),
        ...many(9, { caseName: 'B7' }),
        run({ caseName: 'B7', failed: ['x'] }),
      ],
      [1],
    );
    expect(model?.row.passHat[1]).toBeCloseTo(0.7, 10);
  });
});

describe('failures by class', () => {
  it('count the runs that carried each class', () => {
    const cell = cellOf([
      ...many(2, { failed: ['memory-answer'] }),
      run({ failed: ['wrong-value'] }),
      run(),
    ]);
    expect(cell.failures).toEqual({ 'memory-answer': 2, 'wrong-value': 1 });
  });

  it('leave the judge rubrics out of the classes', () => {
    const cell = cellOf([run({ judge: { 'judge-relevance': 0.1 } })]);
    expect(cell.failures).toEqual({});
  });
});

describe('the informational figures', () => {
  it('take the mean cost over the runs that reported one and say how many did', () => {
    const cell = cellOf([
      ...many(3, { cost: 0.1 }),
      ...many(1, { cost: 0.3 }),
      ...many(2),
    ]);
    expect(cell.cost.count).toBe(4);
    expect(cell.cost.value).toBeCloseTo(0.15, 10);
  });

  it('read n/a, not 0, when no run reported a cost', () => {
    expect(cellOf(many(3)).cost).toEqual({ value: null, count: 0 });
  });

  it('leave an errored run out of the cost although its record holds a 0', () => {
    const cell = cellOf([run({ cost: 0.2 }), run({ error: true })]);
    expect(cell.cost).toEqual({ value: 0.2, count: 1 });
  });

  it('take the highest round of a run as its tool rounds, 0 without calls', () => {
    const cell = cellOf([run({ rounds: [1, 1, 2] }), run({ rounds: [] })]);
    expect(cell.rounds).toEqual({ value: 1, count: 2 });
  });

  it('leave an errored run out of the tool rounds', () => {
    const cell = cellOf([run({ rounds: [3] }), run({ error: true })]);
    expect(cell.rounds).toEqual({ value: 3, count: 1 });
  });

  it('take the mean latency over every run', () => {
    const cell = cellOf([
      run({ latencyMs: 100 }),
      run({ error: true, latencyMs: 300 }),
    ]);
    expect(cell.latency.value).toBe(200);
  });

  it('divide the total cost by the passing runs for the cost per solved task', () => {
    const cell = cellOf([
      ...many(4, { cost: 0.05 }),
      ...many(2, { cost: 0.15, failed: ['x'] }),
    ]);
    // 4 x 0.05 + 2 x 0.15 = 0.5, over 4 passing runs.
    expect(cell.costPerSolved).toBeCloseTo(0.125, 10);
  });

  it.each([
    ['no run passed', [run({ cost: 0.1, failed: ['x'] })]],
    ['no cost was reported', many(2)],
  ])('read - for the cost per solved task when %s', (_, runs) => {
    expect(cellOf(runs).costPerSolved).toBeNull();
  });

  it('pool the totals, not the ratios, in a model row', () => {
    const [model] = summaryOf([
      ...many(1, { caseName: 'A1', cost: 1 }),
      ...many(3, { caseName: 'B7', cost: 0.1 }),
      ...many(1, { caseName: 'B7', cost: 0.1, failed: ['x'] }),
    ]);
    // 1 + 0.4 = 1.4 over 4 passing runs, not the mean of 1 and 0.1333.
    expect(model?.row.costPerSolved).toBeCloseTo(0.35, 10);
  });
});

describe('the judge pass rate', () => {
  const scored = (score: number) =>
    run({ judge: { 'judge-relevance': score } });

  it('is the share of scored runs at or above the threshold, with the unscored count', () => {
    const cell = cellOf([
      ...Array.from({ length: 6 }, () => scored(0.7)),
      ...Array.from({ length: 2 }, () => scored(0.69)),
      run(),
      run({ error: true }),
    ]);
    expect(cell.judges['judge-relevance']).toEqual({
      rate: 0.75,
      scored: 8,
      unscored: 2,
    });
  });

  it('counts a rubric that Jev did not answer as unscored, and not as a score of 0', () => {
    const cell = cellOf([
      scored(0.9),
      run({
        unanswered: {
          'judge-relevance':
            'The state is 32001 bytes, over the limit of 32000.',
        },
      }),
      run({
        unanswered: { 'judge-relevance': 'OPENROUTER_API_KEY is not set.' },
      }),
    ]);
    expect(cell.judges['judge-relevance']).toEqual({
      rate: 1,
      scored: 1,
      unscored: 2,
    });
  });

  it('shows a rubric that no run could score, with every run unscored', () => {
    const cell = cellOf([
      run({
        unanswered: { 'judge-relevance': 'OPENROUTER_API_KEY is not set.' },
      }),
      run({
        unanswered: { 'judge-relevance': 'OPENROUTER_API_KEY is not set.' },
      }),
    ]);
    expect(cell.judges['judge-relevance']).toEqual({
      rate: null,
      scored: 0,
      unscored: 2,
    });
  });

  it('reads the threshold of the run from the results file', () => {
    const [model] = summaryOf([scored(0.5), scored(0.8)], [1], 0.6);
    expect(model?.cells[0]?.judges['judge-relevance']?.rate).toBe(0.5);
  });

  it('does not move the pass estimators', () => {
    const cell = cellOf([scored(0.0), scored(0.0)], [1]);
    expect(cell.passHat[1]).toBe(1);
  });
});

describe('the report command', () => {
  const write = (content: string) => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'evals-report-')),
      'results.json',
    );
    fs.writeFileSync(file, content);
    return file;
  };
  const exec = (args: string[]) => {
    let stdout = '';
    let stderr = '';
    const status = report(args, {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    });
    return { status, stdout, stderr };
  };

  it('exits non-zero with a message and no output when the file is missing', () => {
    const result = exec(['/nonexistent/results.json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/results\.json/);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['not JSON', 'nope'],
    ['not a results file', '{"a":1}'],
  ])('exits non-zero when the file is %s', (_, content) => {
    const result = exec([write(content), '--k', '1']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toBe('');
    expect(result.stdout).toBe('');
  });

  it('exits non-zero and says what is missing without an argument', () => {
    expect(exec([]).status).not.toBe(0);
  });

  it('exits 0 and prints the report even when every run failed', () => {
    const file = write(
      JSON.stringify(
        resultsFile([
          ...many(3, { failed: ['wrong-value'] }),
          run({ error: true }),
        ]),
      ),
    );
    const result = exec([file, '--k', '1,3']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/A1\s+n=4\s+c=0\s+err=1/);
    expect(result.stdout).toContain('wrong-value=3');
  });

  it('exits non-zero with a message that names n and k when k is above n', () => {
    const file = write(JSON.stringify(resultsFile(many(4))));
    const result = exec([file, '--k', '5']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/n=4.*k=5/);
  });

  it('prints the figures of a cell on its line', () => {
    const file = write(
      JSON.stringify(
        resultsFile([
          ...many(7, {
            cost: 0.1,
            rounds: [1],
            judge: { 'judge-relevance': 0.9 },
          }),
          ...many(3, { failed: ['x'] }),
        ]),
      ),
    );
    const { stdout } = exec([file, '--k', '1,3']);
    expect(stdout).toMatch(/A1\s+n=10\s+c=7\s+err=0/);
    expect(stdout).toContain('pass@3=0.9917');
    expect(stdout).toContain('pass^3=0.2917');
    expect(stdout).toMatch(/cost 0\.1000 \(7 runs\)/);
    expect(stdout).toMatch(/cost\/solved 0\.1000/);
    expect(stdout).toMatch(/judge-relevance 1\.00 \(3 unscored\)/);
  });

  it('prints n/a and - where a figure does not exist', () => {
    const file = write(JSON.stringify(resultsFile(many(2))));
    const { stdout } = exec([file, '--k', '1']);
    expect(stdout).toMatch(/cost n\/a \(0 runs\)/);
    expect(stdout).toMatch(/cost\/solved -/);
  });
});

describe('the report, for any mix of runs', () => {
  const spec = fc.record({
    model: fc.constantFrom('m/one', 'm/two'),
    caseName: fc.constantFrom('A1', 'B7', 'C1'),
    error: fc.boolean(),
    failed: fc.subarray(['memory-answer', 'wrong-value', 'run-failed']),
    cost: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), {
      nil: undefined,
    }),
    latencyMs: fc.integer({ min: 0, max: 100_000 }),
    rounds: fc.array(fc.integer({ min: 1, max: 9 }), { maxLength: 4 }),
    judge: fc.dictionary(
      fc.constantFrom('judge-grounding', 'judge-relevance'),
      fc.double({ min: 0, max: 1, noNaN: true }),
    ),
  }) as fc.Arbitrary<RunSpec>;

  it('never throws and always exits 0', () => {
    fc.assert(
      fc.property(fc.array(spec, { minLength: 1, maxLength: 12 }), (specs) => {
        const file = path.join(os.tmpdir(), `evals-prop-${process.pid}.json`);
        fs.writeFileSync(file, JSON.stringify(resultsFile(specs.map(run))));
        let stdout = '';
        const status = report([file, '--k', '1'], {
          out: (text) => {
            stdout += text;
          },
          err: () => {},
        });
        expect(status).toBe(0);
        expect(stdout).not.toMatch(/NaN|undefined|Infinity/);
      }),
    );
  });
});
