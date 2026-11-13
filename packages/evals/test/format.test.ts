import { describe, expect, it } from 'vitest';
import { formatReport, wallTimeLine } from '../src/report/format.js';
import { readRuns } from '../src/report/results.js';
import { summarize } from '../src/report/summary.js';
import { many, resultsFile, run } from './resultsFixture.js';

const render = (runs: ReturnType<typeof run>[], ks: number[]) =>
  formatReport(summarize(readRuns(resultsFile(runs)).runs, ks, 0.7), ks);

describe('the text of the report', () => {
  it('is a block per model, a line group per case, and a mean row', () => {
    const text = render(
      [
        ...many(3, {
          caseName: 'A1',
          cost: 0.1,
          rounds: [1, 2],
          latencyMs: 100,
          judge: { 'judge-relevance': 0.9 },
        }),
        run({
          caseName: 'A1',
          cost: 0.2,
          rounds: [1],
          latencyMs: 200,
          failed: ['wrong-value', 'memory-answer'],
          judge: { 'judge-relevance': 0.5 },
        }),
        run({ caseName: 'LongerCase', latencyMs: 50 }),
        run({ caseName: 'LongerCase', error: true, latencyMs: 51 }),
        run({ model: 'm/two', caseName: 'A1', latencyMs: 10 }),
        run({ model: 'm/two', caseName: 'A1', latencyMs: 12, failed: ['x'] }),
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
        '',
        'm/two',
        '  A1          n=2  c=1  err=0  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '              failed: x=1',
        '              cost n/a (0 runs)  latency 11 ms  rounds 0.00 (2 runs)  cost/solved -',
        '              judge-relevance n/a (2 unscored)',
        '  mean        n=2  c=1  err=0  pass@1=0.5000 pass@2=1.0000  pass^1=0.5000 pass^2=0.0000',
        '              failed: x=1',
        '              cost n/a (0 runs)  latency 11 ms  rounds 0.00 (2 runs)  cost/solved -',
        '              judge-relevance n/a (2 unscored)',
        '',
      ].join('\n'),
    );
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
