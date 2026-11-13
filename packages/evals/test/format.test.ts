import { describe, expect, it } from 'vitest';
import { formatReport, wallTimeLine } from '../src/report/format.js';
import { readRuns } from '../src/report/results.js';
import { summarize } from '../src/report/summary.js';
import { many, resultsFile, run } from './resultsFixture.js';

const render = (runs: ReturnType<typeof run>[], ks: number[]) =>
  formatReport(summarize(readRuns(resultsFile(runs)).runs, ks, 0.7), ks);

describe('the text of the report', () => {
  it('is a block per model, a line group per case, a mean row and the error classes', () => {
    const all = ['run-failed', 'memory-answer', 'wrong-value'];
    const text = render(
      [
        ...many(3, {
          caseName: 'A1',
          checks: all,
          cost: 0.1,
          rounds: [1, 2],
          latencyMs: 100,
          judge: { 'judge-relevance': 0.9 },
        }),
        run({
          caseName: 'A1',
          checks: ['run-failed'],
          cost: 0.2,
          rounds: [1],
          latencyMs: 200,
          failed: ['wrong-value', 'memory-answer'],
          judge: { 'judge-relevance': 0.5 },
        }),
        run({ caseName: 'LongerCase', checks: all, latencyMs: 50 }),
        run({ caseName: 'LongerCase', error: true, latencyMs: 51 }),
        run({ model: 'm/two', caseName: 'A1', checks: all, latencyMs: 10 }),
        run({
          model: 'm/two',
          caseName: 'A1',
          checks: ['run-failed', 'memory-answer'],
          latencyMs: 12,
          failed: ['wrong-value'],
        }),
      ],
      [1, 2],
    );
    expect(text).toBe(
      [
        'm/one',
        '  A1          n=4  c=3  err=0  pass@1=0.7500 pass@2=1.0000  pass^1=0.7500 pass^2=0.5000',
        '              failed: memory-answer=1 wrong-value=1',
        '              cost 0.1250 (4 runs)  latency 125 ms  rounds 1.75 (4 runs)  cost/solved 0.1667',
        '              judge-relevance 0.75 (0 unscored)',
        '  LongerCase  n=2  c=1  err=1  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '              cost n/a (0 runs)  latency 51 ms  rounds 0.00 (1 runs)  cost/solved -',
        '              judge-relevance n/a (2 unscored)',
        '  mean        n=6  c=4  err=1  pass@1=0.6250 pass@2=1.0000  pass^1=0.6250 pass^2=0.2500',
        '              failed: memory-answer=1 wrong-value=1',
        '              cost 0.1250 (4 runs)  latency 100 ms  rounds 1.40 (5 runs)  cost/solved 0.1250',
        '              judge-relevance 0.75 (2 unscored)',
        '  by error class',
        '    run-failed     judged=6  passed=5  failed=1  pass@1=0.7500 pass@2=1.0000  pass^1=0.7500 pass^2=0.5000',
        '    memory-answer  judged=5  passed=4  failed=1  pass@1=0.8750 pass@2=1.0000  pass^1=0.8750 pass^2=0.5000',
        '    wrong-value    judged=4  passed=4  failed=0  pass@1=1.0000 pass@2=1.0000  pass^1=1.0000 pass^2=1.0000',
        '',
        'm/two',
        '  A1          n=2  c=1  err=0  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '              failed: wrong-value=1',
        '              cost n/a (0 runs)  latency 11 ms  rounds 0.00 (2 runs)  cost/solved -',
        '              judge-relevance n/a (2 unscored)',
        '  mean        n=2  c=1  err=0  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '              failed: wrong-value=1',
        '              cost n/a (0 runs)  latency 11 ms  rounds 0.00 (2 runs)  cost/solved -',
        '              judge-relevance n/a (2 unscored)',
        '  by error class',
        '    run-failed     judged=2  passed=2  failed=0  pass@1=1.0000 pass@2=1.0000  pass^1=1.0000 pass^2=1.0000',
        '    memory-answer  judged=2  passed=2  failed=0  pass@1=1.0000 pass@2=1.0000  pass^1=1.0000 pass^2=1.0000',
        '    wrong-value    judged=2  passed=1  failed=1  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '',
      ].join('\n'),
    );
  });

  it('shows - for the estimators of a class that no case can give', () => {
    const text = render(
      [
        ...many(3, { checks: ['run-failed', 'wrong-value'] }),
        ...many(7, { checks: ['run-failed'], failed: ['memory-answer'] }),
      ],
      [5],
    );
    expect(text).toContain(
      '    wrong-value    judged=3  passed=3  failed=0  pass@5=-  pass^5=-',
    );
  });

  it('shows run-failed alone for a model whose runs all ended in an error', () => {
    const text = render(many(2, { error: true }), [1]);
    expect(text).toContain('  by error class\n');
    expect(text).toContain(
      '    run-failed  judged=2  passed=0  failed=2  pass@1=0.0000  pass^1=0.0000',
    );
    expect(text).not.toContain('memory-answer');
  });

  it('is empty when there are no runs', () => {
    expect(render([], [1])).toBe('');
  });

  it('pads the labels to the longest case and at least to the word mean', () => {
    const text = render([run({ caseName: 'X' })], [1]);
    expect(text).toContain('\n  X     n=1');
    expect(text).toContain('\n  mean  n=1');
  });
});

describe('a figure that no run reported', () => {
  it('reads n/a for the latency', () => {
    expect(render([run({ latencyMs: null })], [1])).toContain('latency n/a  ');
  });
});

describe('the wall time line', () => {
  it('says the time in seconds, the runs and the concurrency', () => {
    expect(wallTimeLine({ wallTimeMs: 30815, concurrency: 4 }, 30)).toBe(
      'wall time 30.8 s for 30 runs (concurrency 4)\n',
    );
  });

  it('leaves out the concurrency when it is not known, and says run for one run', () => {
    expect(wallTimeLine({ wallTimeMs: 450 }, 1)).toBe(
      'wall time 0.5 s for 1 run\n',
    );
    expect(wallTimeLine({ wallTimeMs: 0 }, 0)).toBe(
      'wall time 0.0 s for 0 runs\n',
    );
  });

  it('is empty when the file holds no wall time', () => {
    expect(wallTimeLine({}, 30)).toBe('');
  });
});
