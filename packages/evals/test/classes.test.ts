import { describe, expect, it } from 'vitest';
import { readRuns } from '../src/report/results.js';
import { summarize } from '../src/report/summary.js';
import { many, resultsFile, run } from './resultsFixture.js';

const classesOf = (runs: ReturnType<typeof run>[], ks = [1, 3]) => {
  const read = readRuns(resultsFile(runs));
  const [model] = summarize(read.runs, ks, read.thresholds);
  return model?.classes ?? [];
};

const row = (runs: ReturnType<typeof run>[], name: string, ks?: number[]) =>
  classesOf(runs, ks).find((entry) => entry.name === name);

describe('the metrics a run was judged by', () => {
  it('are the checks that ran on it, passed or failed, and not the judge rubrics', () => {
    const [read] = readRuns(
      resultsFile([
        run({
          checks: ['run-failed', 'memory-answer'],
          failed: ['wrong-value'],
          judge: { 'judge-relevance': 0.9 },
        }),
      ]),
    ).runs;
    expect(read?.judged.sort()).toEqual([
      'memory-answer',
      'run-failed',
      'wrong-value',
    ]);
  });

  it('are none when the grading has no list of components', () => {
    for (const gradingResult of [null, {}, { componentResults: 'x' }]) {
      const entry = { ...run(), gradingResult };
      expect(
        readRuns({ results: { results: [entry] } }).runs[0]?.judged,
      ).toEqual([]);
    }
  });

  it('are none for a provider error and for a run with no grading', () => {
    expect(
      readRuns(resultsFile([run({ error: true })])).runs[0]?.judged,
    ).toEqual([]);
  });
});

describe('the classes of a model', () => {
  it('count the runs a class judged, passed and failed', () => {
    const runs = [
      ...many(8, { checks: ['run-failed', 'wrong-value'] }),
      ...many(2, { checks: ['run-failed'], failed: ['wrong-value'] }),
    ];
    expect(row(runs, 'wrong-value')).toMatchObject({
      judged: 10,
      passed: 8,
      failed: 2,
      cases: 1,
    });
    expect(row(runs, 'run-failed')).toMatchObject({
      judged: 10,
      passed: 10,
      failed: 0,
    });
  });

  it('do not judge a run after an earlier class of the chain failed it', () => {
    const runs = [
      ...many(3, { checks: ['run-failed'], failed: ['memory-answer'] }),
      ...many(7, { checks: ['run-failed', 'memory-answer', 'invented-data'] }),
    ];
    expect(row(runs, 'memory-answer')).toMatchObject({
      judged: 10,
      passed: 7,
      failed: 3,
    });
    expect(row(runs, 'invented-data')).toMatchObject({
      judged: 7,
      passed: 7,
      failed: 0,
    });
  });

  it('judge a provider error as a failed run-failed and in no other class', () => {
    const runs = [
      ...many(8, { checks: ['run-failed', 'wrong-value'] }),
      ...many(2, { error: true }),
    ];
    expect(row(runs, 'run-failed')).toMatchObject({
      judged: 10,
      passed: 8,
      failed: 2,
    });
    expect(row(runs, 'wrong-value')).toMatchObject({
      judged: 8,
      passed: 8,
      failed: 0,
    });
  });

  it('let a class that stands beside the chain be judged after any class but run-failed', () => {
    const runs = [
      ...many(4, {
        checks: ['run-failed'],
        failed: ['memory-answer', 'needless-lookup'],
      }),
      ...many(6, { checks: ['run-failed', 'needless-lookup'] }),
    ];
    expect(row(runs, 'needless-lookup')).toMatchObject({
      judged: 10,
      passed: 6,
      failed: 4,
    });
  });

  it('put the later classes of the chain after wrong-answer, phantom-match and bad-recommendation alike', () => {
    for (const earlier of [
      'wrong-answer',
      'phantom-match',
      'bad-recommendation',
    ]) {
      const runs = [
        ...many(2, { checks: ['run-failed'], failed: [earlier] }),
        ...many(8, { checks: ['run-failed', 'wrong-value'] }),
      ];
      expect(row(runs, 'wrong-value'), earlier).toMatchObject({ judged: 8 });
    }
  });

  it('do not let a class of the same level exclude another of it', () => {
    const runs = [
      ...many(5, {
        checks: ['run-failed', 'bad-recommendation'],
        failed: ['wrong-answer'],
      }),
      ...many(5, { checks: ['run-failed', 'bad-recommendation'] }),
    ];
    expect(row(runs, 'bad-recommendation')).toMatchObject({
      judged: 10,
      passed: 10,
    });
  });

  it('are listed in the order of the taxonomy, the others after, by name', () => {
    const runs = many(1, {
      checks: [
        'zeta',
        'wrong-value',
        'alpha',
        'memory-answer',
        'run-failed',
        'invented-data',
      ],
    });
    expect(classesOf(runs, [1]).map((entry) => entry.name)).toEqual([
      'run-failed',
      'memory-answer',
      'invented-data',
      'wrong-value',
      'alpha',
      'zeta',
    ]);
  });

  it('count the cases that have the class', () => {
    const runs = [
      ...many(2, { caseName: 'a/one', checks: ['run-failed', 'wrong-value'] }),
      ...many(2, { caseName: 'b/two', checks: ['run-failed', 'wrong-value'] }),
      ...many(2, { caseName: 'c/three', checks: ['run-failed'] }),
    ];
    expect(row(runs, 'wrong-value', [1])).toMatchObject({
      cases: 2,
      judged: 4,
    });
    expect(row(runs, 'run-failed', [1])).toMatchObject({ cases: 3, judged: 6 });
  });
});

describe('the estimators of a class', () => {
  it('are those of its judged runs, 7 of 10 giving 0.9917 and 0.2917 at k = 3', () => {
    const runs = [
      ...many(7, { checks: ['run-failed', 'wrong-value'] }),
      ...many(3, { checks: ['run-failed'], failed: ['wrong-value'] }),
    ];
    const entry = row(runs, 'wrong-value');
    expect(entry?.passAt[3]).toBeCloseTo(0.9917, 4);
    expect(entry?.passHat[3]).toBeCloseTo(0.2917, 4);
    expect(entry?.passAt[1]).toBeCloseTo(0.7, 10);
  });

  it('are the mean over the cases, each case with equal weight', () => {
    const runs = [
      ...many(10, { caseName: 'a/one', checks: ['run-failed', 'wrong-value'] }),
      ...many(5, { caseName: 'b/two', checks: ['run-failed', 'wrong-value'] }),
      ...many(5, {
        caseName: 'b/two',
        checks: ['run-failed'],
        failed: ['wrong-value'],
      }),
    ];
    expect(row(runs, 'wrong-value', [1])?.passHat[1]).toBeCloseTo(0.75, 10);
  });

  it('leave out a case whose judged runs are fewer than k, and show - when none is left', () => {
    const runs = [
      ...many(10, { caseName: 'a/one', checks: ['run-failed', 'wrong-value'] }),
      // Eight runs of b/two fail an earlier class, so wrong-value judges two of its ten.
      ...many(8, {
        caseName: 'b/two',
        checks: ['run-failed'],
        failed: ['memory-answer'],
      }),
      ...many(2, {
        caseName: 'b/two',
        checks: ['run-failed'],
        failed: ['wrong-value'],
      }),
    ];
    const entry = row(runs, 'wrong-value', [1, 3]);
    // k = 3 leaves b/two out, k = 1 keeps both.
    expect(entry?.passHat[3]).toBeCloseTo(1, 10);
    expect(entry?.passHat[1]).toBeCloseTo(0.5, 10);
    const few = [
      ...many(3, { checks: ['run-failed', 'wrong-value'] }),
      ...many(7, { checks: ['run-failed'], failed: ['memory-answer'] }),
    ];
    expect(row(few, 'wrong-value', [5])?.passAt[5]).toBeNull();
    expect(row(few, 'wrong-value', [5])?.passHat[5]).toBeNull();
  });
});
