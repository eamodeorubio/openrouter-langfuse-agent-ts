import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  agreement,
  analyze,
  auc,
  bestThreshold,
  formatAnalysis,
  type Pair,
  sweep,
  weightAdvice,
} from '../src/calibrate/analyze.js';
import type { CalibrationRecord, Verdict } from '../src/calibrate/types.js';

const R = 'judge-relevance';

/** The figures of a rubric that has answers enough, unless a test says otherwise. */
const advice = (
  figures: Omit<Parameters<typeof weightAdvice>[0], 'yes' | 'no'> & {
    yes?: number;
    no?: number;
  },
) => weightAdvice({ yes: 30, no: 30, ...figures });

const pair = (score: number, label: boolean, caseName = 'c'): Pair => ({
  score,
  label,
  case: caseName,
});

const rec = (
  caseName: string,
  score: number | undefined,
  verdict: Verdict | undefined,
  extra: Partial<CalibrationRecord> = {},
): CalibrationRecord => ({
  id: `${caseName}-${score}-${verdict}-${Math.random()}`,
  case: caseName,
  model: 'm',
  repeat: 0,
  prompt: 'q',
  transcript: { toolCalls: [], answer: 'a' },
  states: { [R]: 's' },
  jevAssertScores: score === undefined ? {} : { [R]: score },
  ...(verdict === undefined ? {} : { opusScore: { [R]: verdict } }),
  ...extra,
});

describe('agreement at a threshold', () => {
  const pairs = [
    pair(0.9, true),
    pair(0.8, true),
    pair(0.6, true),
    pair(0.4, false),
    pair(0.3, false),
    pair(0.55, false),
  ];

  it('is the share of yes that score at or above it, and of no that score below it, with the counts', () => {
    expect(agreement(pairs, 0.5)).toEqual({
      tp: 3,
      fn: 0,
      tn: 2,
      fp: 1,
      truePositiveRate: 1,
      trueNegativeRate: 2 / 3,
      balanced: (1 + 2 / 3) / 2,
    });
    expect(agreement(pairs, 0.6).fn).toBe(0);
    expect(agreement(pairs, 0.61).fn).toBe(1);
  });

  it('counts a score exactly at the threshold as yes', () => {
    expect(agreement([pair(0.5, true)], 0.5).tp).toBe(1);
    expect(agreement([pair(0.5, false)], 0.5).fp).toBe(1);
  });

  it('has no rate for a class that is empty', () => {
    expect(agreement([pair(0.9, true)], 0.5).trueNegativeRate).toBeNull();
    expect(agreement([pair(0.9, true)], 0.5).balanced).toBeNull();
  });
});

describe('the sweep', () => {
  it('goes from 0 to 1 in steps of 0.05, with the balanced agreement at each', () => {
    const rows = sweep([pair(0.9, true), pair(0.1, false)]);
    expect(rows).toHaveLength(21);
    expect(rows[0]?.threshold).toBe(0);
    expect(rows[1]?.threshold).toBe(0.05);
    expect(rows[20]?.threshold).toBe(1);
    expect(rows.find((r) => r.threshold === 0.5)?.balanced).toBe(1);
    expect(rows[0]?.balanced).toBe(0.5);
  });
});

describe('the AUC', () => {
  it('is 1 when every yes scores above every no', () => {
    expect(auc([pair(0.9, true), pair(0.8, true), pair(0.2, false)])).toBe(1);
  });

  it('is 0 when every yes scores below every no, and 0.5 for the same distribution', () => {
    expect(auc([pair(0.1, true), pair(0.9, false)])).toBe(0);
    expect(
      auc([
        pair(0.3, true),
        pair(0.7, true),
        pair(0.3, false),
        pair(0.7, false),
      ]),
    ).toBe(0.5);
  });

  it('is undefined without both classes', () => {
    expect(auc([pair(0.9, true)])).toBeUndefined();
    expect(auc([])).toBeUndefined();
  });

  it('is in 0 to 1, falls to its complement when the labels are swapped, and does not depend on order', () => {
    const pairs = fc.array(
      fc.record({
        score: fc.double({ min: 0, max: 1, noNaN: true }),
        label: fc.boolean(),
      }),
      { minLength: 2, maxLength: 30 },
    );
    fc.assert(
      fc.property(pairs, (rows) => {
        const all = rows.map((r) => pair(r.score, r.label));
        const value = auc(all);
        if (value === undefined) return;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        const swapped = auc(all.map((p) => ({ ...p, label: !p.label })));
        expect((swapped ?? Number.NaN) + value).toBeCloseTo(1, 10);
        expect(auc([...all].reverse())).toBeCloseTo(value, 10);
      }),
    );
  });
});

describe('the best threshold', () => {
  it('is the middle of the range of thresholds within one point of the best agreement', () => {
    const rows = [
      pair(0.9, true),
      pair(0.85, true),
      pair(0.7, true),
      pair(0.3, false),
      pair(0.2, false),
      pair(0.1, false),
    ];
    const best = bestThreshold(sweep(rows));
    expect(best?.low).toBe(0.35);
    expect(best?.high).toBe(0.7);
    expect(best?.threshold).toBe(0.53);
    expect(best?.balanced).toBe(1);
  });
});

describe('analyzing a rubric', () => {
  const clear = [
    ...[0.9, 0.85, 0.8, 0.95, 0.7, 0.75].map((s, i) =>
      rec(`case${i % 3}`, s, 'yes'),
    ),
    ...[0.1, 0.2, 0.3, 0.15, 0.25, 0.05].map((s, i) =>
      rec(`case${i % 3}`, s, 'no'),
    ),
  ];

  it('works out the AUC, the best threshold and the agreement for separable scores', () => {
    const [result] = analyze(clear);
    expect(result?.rubric).toBe(R);
    expect(result?.samples).toEqual({
      yes: 6,
      no: 6,
      ambiguous: 0,
      unscored: 0,
    });
    expect(result?.auc).toBe(1);
    expect(result?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.53,
    });
    expect(result?.atRecommended?.balanced).toBe(1);
    expect(result?.leaveOneCaseOut.maxShift).toBeLessThanOrEqual(0.1);
  });

  it('reports a rubric that does not separate as not worth a threshold', () => {
    const same = [0.3, 0.7, 0.5, 0.2, 0.8, 0.6].flatMap((s, i) => [
      rec(`case${i % 3}`, s, 'yes'),
      rec(`case${i % 3}`, s, 'no'),
    ]);
    const [result] = analyze(same);
    expect(result?.auc).toBeCloseTo(0.5, 1);
    expect(result?.recommendation).toEqual({ kind: 'not-worth' });
  });

  it('reports a rubric as suspect, with no threshold, when the thresholds that agree best lie below 0.5', () => {
    const lowYes = [
      ...[0.3, 0.35, 0.4, 0.32].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.05, 0.1, 0.12, 0.08].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    const [result] = analyze(lowYes);
    expect(result?.auc).toBe(1);
    expect(result?.recommendation).toEqual({ kind: 'suspect' });
  });

  it('recommends 0.5 and does not call a rubric suspect when the range reaches 0.5', () => {
    const wide = [
      ...[0.62, 0.7, 0.9, 0.65].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.38, 0.3, 0.1, 0.35].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    expect(analyze(wide)[0]?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.5,
    });
  });

  it('counts ambiguous answers apart, and leaves them and unscored records out of the fit', () => {
    const [result] = analyze([
      ...clear,
      rec('case0', 0.5, 'ambiguous'),
      rec('case1', 0.4, 'ambiguous'),
      rec('case2', undefined, 'yes'),
      rec('case2', 0.9, undefined),
    ]);
    expect(result?.samples).toEqual({
      yes: 6,
      no: 6,
      ambiguous: 2,
      unscored: 1,
    });
    expect(result?.ambiguousShare).toBeCloseTo(2 / 14, 10);
    expect(result?.auc).toBe(1);
  });

  it('says there is not enough to calibrate when only one of yes and no was answered', () => {
    const [result] = analyze([rec('c', 0.9, 'yes'), rec('c', 0.8, 'yes')]);
    expect(result?.auc).toBeUndefined();
    expect(result?.recommendation).toEqual({ kind: 'not-enough' });
  });

  it('shows how the best threshold moves when each case is left out', () => {
    const skewed = [
      ...clear,
      rec('odd', 0.4, 'yes'),
      rec('odd', 0.45, 'yes'),
      rec('odd', 0.42, 'yes'),
    ];
    const [result] = analyze(skewed);
    expect(result?.leaveOneCaseOut.shifts.odd).toBeGreaterThan(0.1);
    expect(result?.leaveOneCaseOut.maxShift).toBeGreaterThan(0.1);
  });

  it('measures how often Opus and Jev reject the controls that are expected to fail the rubric', () => {
    const controls = [
      ...[0.1, 0.2, 0.15, 0.3].map((s, i) =>
        rec(`case${i}`, s, 'no', {
          control: 'answer-swapped',
          expectedFail: [R],
        }),
      ),
      rec('case9', 0.9, 'yes', {
        control: 'figure-invented',
        expectedFail: [R],
      }),
      rec('case9', 0.9, 'yes', {
        control: 'figure-invented',
        expectedFail: ['other'],
      }),
    ];
    const [result] = analyze([...clear, ...controls]);
    expect(result?.controls).toEqual({
      count: 5,
      opusRejected: 4 / 5,
      jevRejected: 4 / 5,
    });
  });

  it('works out each rubric on its own, in the order of the files', () => {
    const two = [
      {
        ...rec('a', 0.9, 'yes'),
        jevAssertScores: { [R]: 0.9, 'judge-grounding': 0.1 },
        states: { [R]: 's', 'judge-grounding': 's' },
        opusScore: { [R]: 'yes', 'judge-grounding': 'yes' } as Record<
          string,
          Verdict
        >,
      },
      {
        ...rec('b', 0.1, 'no'),
        jevAssertScores: { [R]: 0.1, 'judge-grounding': 0.9 },
        states: { [R]: 's', 'judge-grounding': 's' },
        opusScore: { [R]: 'no', 'judge-grounding': 'no' } as Record<
          string,
          Verdict
        >,
      },
    ];
    const results = analyze(two);
    expect(results.map((r) => r.rubric)).toEqual(['judge-grounding', R]);
    expect(results[0]?.auc).toBe(0);
    expect(results[1]?.auc).toBe(1);
  });
});

describe('the weight', () => {
  const strong = {
    auc: 0.95,
    balanced: 0.93,
    maxShift: 0.05,
    controls: { count: 20, opusRejected: 0.96, jevRejected: 0.96 },
  };

  it('may count when every criterion is met', () => {
    expect(advice(strong)).toEqual({ weight: 'may count', unmet: [] });
  });

  it('is kept at 0, naming the criterion not met, when one is short', () => {
    expect(advice({ ...strong, balanced: 0.85 })).toEqual({
      weight: 'keep 0',
      unmet: ['agreement on the cases left out 0.85 is under 0.9'],
    });
    expect(advice({ ...strong, auc: 0.89 }).unmet).toEqual([
      'AUC 0.89 is under 0.9',
    ]);
    expect(advice({ ...strong, maxShift: 0.15 }).unmet).toEqual([
      'the threshold moves by 0.15 when a case is left out, over 0.1',
    ]);
    expect(
      advice({
        ...strong,
        controls: { count: 20, opusRejected: 0.8, jevRejected: 0.96 },
      }).unmet,
    ).toEqual(['Opus rejects 80% of the controls, under 90%']);
    expect(
      advice({
        ...strong,
        controls: { count: 20, opusRejected: 0.96, jevRejected: 0.7 },
      }).unmet,
    ).toEqual(['Jev rejects 70% of the controls, under 90%']);
  });

  it('is kept at 0 when there are no controls to judge it by, and names every criterion not met', () => {
    expect(
      advice({
        ...strong,
        controls: { count: 0, opusRejected: 0, jevRejected: null },
      }).unmet,
    ).toEqual(['no controls were judged']);
    expect(
      advice({
        auc: 0.5,
        balanced: 0.5,
        maxShift: 0.3,
        controls: { count: 0, opusRejected: 0, jevRejected: null },
      }).unmet,
    ).toHaveLength(4);
  });

  it('is kept at 0 for a rubric with no threshold recommended', () => {
    const wide = [
      ...[0.62, 0.7, 0.9, 0.65].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.38, 0.3, 0.1, 0.35].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    expect(analyze(wide)[0]?.weight.weight).toBe('keep 0');
    const suspect = [
      ...[0.3, 0.35, 0.4, 0.32].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.05, 0.1, 0.12, 0.08].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    expect(analyze(suspect)[0]?.weight).toEqual({
      weight: 'keep 0',
      unmet: ['no threshold is recommended'],
    });
  });

  it('counts the controls toward the 20 yes and 20 no a weight needs', () => {
    const real = Array.from({ length: 10 }, (_, i) => rec(`c${i}`, 0.9, 'yes'));
    const controls = Array.from({ length: 20 }, (_, i) =>
      rec(`c${i}`, 0.1, 'no', { control: 'answer-swapped', expectedFail: [R] }),
    );
    const unmet = analyze([...real, ...real, ...controls])[0]?.weight.unmet;
    // 20 yes and 20 no, the controls among them: neither count is short.
    expect(unmet?.join(';')).not.toMatch(
      /yes answers, under 20|no answers, under 20/,
    );
  });
});

describe('the report of an analysis', () => {
  it('names each rubric, its recommendation and its weight, and changes nothing', () => {
    const records = [
      ...[0.9, 0.85, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
      ...[0.1, 0.2, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
    ];
    const text = formatAnalysis(analyze(records));
    expect(text).toContain(R);
    expect(text).toContain('AUC 1.00');
    expect(text).toContain('threshold 0.58');
    expect(text).toContain('weight: keep 0');
    expect(formatAnalysis([])).toBe('No rubric has an answer from Opus yet.\n');
  });

  it('says why a rubric gets no threshold', () => {
    const suspect = [
      ...[0.3, 0.35, 0.4, 0.32].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.05, 0.1, 0.12, 0.08].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    expect(formatAnalysis(analyze(suspect))).toContain(
      'suspect: the thresholds that agree best with Opus lie below 0.5',
    );
    const same = [0.3, 0.7, 0.5, 0.2].flatMap((s, i) => [
      rec(`case${i}`, s, 'yes'),
      rec(`case${i}`, s, 'no'),
    ]);
    expect(formatAnalysis(analyze(same))).toContain('not worth a threshold');
    expect(formatAnalysis(analyze([rec('c', 0.9, 'yes')]))).toContain(
      'not enough yes and no answers',
    );
  });
});

describe('the edges of the thresholds', () => {
  const strong = {
    auc: 0.9,
    balanced: 0.9,
    maxShift: 0.1,
    controls: { count: 10, opusRejected: 0.9, jevRejected: 0.9 },
  };

  it('counts a figure exactly at its limit as met', () => {
    expect(advice(strong)).toEqual({ weight: 'may count', unmet: [] });
  });

  it('says so when Jev scored none of the controls', () => {
    expect(
      advice({
        ...strong,
        controls: { count: 10, opusRejected: 0.9, jevRejected: null },
      }).unmet,
    ).toEqual(['Jev scored none of the controls']);
  });

  it('keeps a rubric whose AUC is exactly 0.7, and calls one under it not worth a threshold', () => {
    const edge = [
      ...Array.from({ length: 7 }, (_, i) => rec(`c${i}`, 0.9, 'yes')),
      ...Array.from({ length: 3 }, (_, i) => rec(`c${i}`, 0.1, 'yes')),
      rec('c0', 0.5, 'no'),
    ];
    const [kept] = analyze(edge);
    expect(kept?.auc).toBe(0.7);
    expect(kept?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.73,
    });
    const [lost] = analyze([...edge, rec('c9', 0.95, 'no')]);
    expect(lost?.auc).toBeLessThan(0.7);
    expect(lost?.recommendation).toEqual({ kind: 'not-worth' });
  });

  it('does not call a rubric suspect when its best thresholds end exactly at 0.5', () => {
    const edge = [
      ...[0.5, 0.5, 0.5].map((s, i) => rec(`c${i}`, s, 'yes')),
      ...[0.3, 0.3, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
    ];
    const [result] = analyze(edge);
    expect(result?.best?.high).toBe(0.5);
    expect(result?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.43,
    });
  });

  it('counts a score that equals the threshold as no rejection by Jev', () => {
    const [result] = analyze([
      rec('a', 0.6, 'yes'),
      rec('b', 0.35, 'no'),
      rec('a', 0.5, 'ambiguous', {
        control: 'answer-swapped',
        expectedFail: [R],
      }),
    ]);
    expect(result?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.5,
    });
    expect(result?.controls.jevRejected).toBe(0);
  });
});

describe('the controls of an analysis', () => {
  const base = [
    ...[0.9, 0.85, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
    ...[0.1, 0.2, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
  ];

  it('count only controls that are expected to fail the rubric and that Opus judged', () => {
    const [result] = analyze([
      ...base,
      // A run, not a control, even if it names the rubric.
      rec('x', 0.1, 'no', { expectedFail: [R] }),
      // A control that Opus did not judge.
      rec('x', 0.1, undefined, {
        control: 'answer-swapped',
        expectedFail: [R],
      }),
      // A control that Jev did not score.
      rec('x', undefined, 'no', {
        control: 'answer-swapped',
        expectedFail: [R],
      }),
      rec('x', 0.2, 'no', { control: 'answer-swapped', expectedFail: [R] }),
    ]);
    expect(result?.controls).toEqual({
      count: 2,
      opusRejected: 1,
      jevRejected: 1,
    });
  });

  it('say nothing of rates when there is no control, and nothing of Jev when it scored none', () => {
    expect(analyze(base)[0]?.controls).toEqual({
      count: 0,
      opusRejected: 0,
      jevRejected: null,
    });
    const [result] = analyze([
      ...base,
      rec('x', undefined, 'no', {
        control: 'answer-swapped',
        expectedFail: [R],
      }),
    ]);
    expect(result?.controls).toEqual({
      count: 1,
      opusRejected: 1,
      jevRejected: null,
    });
  });
});

describe('the figures of an analysis', () => {
  it('has no share of ambiguous answers when none was answered with a score, and does not divide by zero', () => {
    const [result] = analyze([
      rec('a', undefined, 'yes'),
      rec('b', undefined, 'no'),
    ]);
    expect(result?.samples).toEqual({
      yes: 0,
      no: 0,
      ambiguous: 0,
      unscored: 2,
    });
    expect(result?.ambiguousShare).toBe(0);
  });

  it('puts the rubrics it does not know after the four, by name', () => {
    const make = (metric: string) => ({
      ...rec('a', 0.9, 'yes'),
      jevAssertScores: { [metric]: 0.9 },
      states: { [metric]: 's' },
      opusScore: { [metric]: 'yes' as Verdict },
    });
    expect(
      analyze([make('judge-b'), make('judge-a'), make('judge-tool-usage')]).map(
        (r) => r.rubric,
      ),
    ).toEqual(['judge-tool-usage', 'judge-a', 'judge-b']);
  });

  it('leaves out of the leave-one-case-out a case whose removal leaves only one class', () => {
    const [result] = analyze([
      rec('only-yes', 0.9, 'yes'),
      rec('only-yes', 0.8, 'yes'),
      rec('only-no', 0.1, 'no'),
      rec('only-no', 0.2, 'no'),
    ]);
    expect(result?.leaveOneCaseOut).toEqual({
      maxShift: 0,
      shifts: {},
      heldOut: null,
    });
  });
});

describe('the text of an analysis', () => {
  it('reads as one block for each rubric, with every figure', () => {
    const records = [
      ...[0.9, 0.85, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
      ...[0.1, 0.2, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
      rec('c0', 0.6, 'ambiguous'),
      rec('x', 0.2, 'no', { control: 'answer-swapped', expectedFail: [R] }),
    ];
    expect(formatAnalysis(analyze(records))).toBe(
      [
        'judge-relevance',
        '  samples: 3 yes, 4 no, 1 ambiguous (12.5%), 0 unscored; 1 of the yes and no answers are controls',
        '  AUC 1.00',
        '  threshold 0.58 (the thresholds from 0.35 to 0.80 agree best, balanced agreement 1.00)',
        "  at the config's 0.5: balanced agreement 1.00",
        '  leaving each case out moves the threshold by at most 0.03, and the agreement on the case left out is 1.00',
        '  controls: 1 judged, Opus rejects 100%, Jev rejects 100%',
        '  weight: keep 0 (only 3 yes answers, under 20; only 4 no answers, under 20)',
      ]
        .join('\n')
        .concat('\n'),
    );
  });

  it('lists what keeps a weight at 0', () => {
    const records = [
      ...[0.9, 0.85, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
      ...[0.1, 0.2, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
    ];
    expect(formatAnalysis(analyze(records))).toContain(
      '  controls: 0 judged, Opus rejects n/a, Jev rejects n/a\n  weight: keep 0 (only 3 yes answers, under 20; only 3 no answers, under 20; no controls were judged)\n',
    );
  });

  it('separates the blocks of two rubrics with an empty line, and ends with a newline', () => {
    const two = {
      ...rec('a', 0.9, 'yes'),
      jevAssertScores: { [R]: 0.9, 'judge-grounding': 0.9 },
      states: { [R]: 's', 'judge-grounding': 's' },
      opusScore: { [R]: 'yes', 'judge-grounding': 'yes' } as Record<
        string,
        Verdict
      >,
    };
    const text = formatAnalysis(analyze([two]));
    expect(text.split('\n\n')).toHaveLength(2);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('what a one-sided sample leaves undefined', () => {
  it('has no rate for the class that is missing, on either side', () => {
    const onlyNo = agreement([pair(0.1, false)], 0.5);
    expect(onlyNo.truePositiveRate).toBeNull();
    expect(onlyNo.balanced).toBeNull();
    expect(onlyNo.trueNegativeRate).toBe(1);
    expect(bestThreshold(sweep([pair(0.9, true)]))).toBeUndefined();
    expect(bestThreshold(sweep([]))).toBeUndefined();
  });

  it('writes n/a for a figure that is not there', () => {
    const [result] = analyze([rec('c', 0.9, 'yes')]);
    const text = formatAnalysis([result as never]);
    expect(text).toContain('  AUC n/a\n');
    expect(text).toContain("at the config's 0.5: balanced agreement n/a\n");
  });
});

describe('the plateau of the best thresholds', () => {
  it('takes in a threshold that agrees exactly one point below the best', () => {
    const pairs = [
      ...Array.from({ length: 98 }, () => pair(0.8, true)),
      pair(0.4, true),
      pair(0.4, true),
      ...Array.from({ length: 100 }, () => pair(0.1, false)),
    ];
    const best = bestThreshold(sweep(pairs));
    expect(best?.balanced).toBe(1);
    expect(best?.low).toBe(0.15);
    expect(best?.high).toBe(0.8);
    expect(best?.threshold).toBe(0.48);
  });
});

describe('the threshold that the controls are judged at', () => {
  const base = [
    ...[0.9, 0.85, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
    ...[0.1, 0.2, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
  ];
  const control = (score: number) =>
    rec('x', score, 'ambiguous', {
      control: 'answer-swapped',
      expectedFail: [R],
    });

  it('is the one recommended, and not the one of the config', () => {
    // The recommended threshold is 0.58: a control at 0.55 is rejected there, and not at 0.5.
    const [result] = analyze([...base, control(0.55)]);
    expect(result?.recommendation).toEqual({
      kind: 'threshold',
      threshold: 0.58,
    });
    expect(result?.controls.jevRejected).toBe(1);
  });

  it('is the one of the config when no threshold is recommended', () => {
    const suspect = [
      ...[0.3, 0.35, 0.4, 0.32].map((s, i) => rec(`case${i}`, s, 'yes')),
      ...[0.05, 0.1, 0.12, 0.08].map((s, i) => rec(`case${i}`, s, 'no')),
    ];
    // Under 0.5 a control is rejected, and over it is not.
    expect(analyze([...suspect, control(0.45)])[0]?.controls.jevRejected).toBe(
      1,
    );
    expect(analyze([...suspect, control(0.55)])[0]?.controls.jevRejected).toBe(
      0,
    );
  });

  it('leaves out a control that names no list of rubrics it should fail', () => {
    const [result] = analyze([
      ...base,
      rec('x', 0.1, 'no', { control: 'answer-swapped' }),
    ]);
    expect(result?.controls.count).toBe(0);
  });
});

describe('the lines of the text', () => {
  it('joins what keeps a weight at 0 with a semicolon', () => {
    const weak = [
      ...[0.9, 0.5, 0.8].map((s, i) => rec(`c${i}`, s, 'yes')),
      ...[0.1, 0.6, 0.3].map((s, i) => rec(`c${i}`, s, 'no')),
    ];
    const text = formatAnalysis(analyze(weak));
    expect(text).toMatch(
      /weight: keep 0 \(only \d+ yes answers, under 20; only \d+ no answers, under 20; AUC [\d.]+ is under 0\.9; /,
    );
  });
});

describe('a weight that may count', () => {
  const many = (
    count: number,
    scoreOf: (i: number) => number,
    verdict: Verdict,
  ) =>
    Array.from({ length: count }, (_, i) =>
      rec(`case${i % 5}`, scoreOf(i), verdict),
    );
  const sound = { auc: 1, balanced: 1, maxShift: 0 };
  const controls = { count: 10, opusRejected: 1, jevRejected: 1 };

  it('is recommended when there are answers enough and every criterion is met, held-out agreement included', () => {
    const records = [
      ...many(25, (i) => 0.8 + (i % 5) / 50, 'yes'),
      ...many(25, (i) => 0.1 + (i % 5) / 50, 'no'),
      ...Array.from({ length: 10 }, (_, i) =>
        rec(`case${i % 5}`, 0.15, 'no', {
          control: 'answer-swapped',
          expectedFail: [R],
        }),
      ),
    ];
    const [result] = analyze(records);
    expect(result?.leaveOneCaseOut.heldOut).toBe(1);
    expect(result?.controlsInFit).toBe(10);
    expect(result?.weight).toEqual({ weight: 'may count', unmet: [] });
  });

  it('is kept at 0 for answers too few, however well they agree', () => {
    expect(advice({ yes: 19, no: 50, ...sound, controls }).unmet).toEqual([
      'only 19 yes answers, under 20',
    ]);
    expect(advice({ yes: 50, no: 19, ...sound, controls }).unmet).toEqual([
      'only 19 no answers, under 20',
    ]);
    expect(advice({ yes: 20, no: 20, ...sound, controls }).unmet).toEqual([]);
  });

  it('is kept at 0 when the agreement on a case left out cannot be worked out', () => {
    expect(advice({ ...sound, balanced: null, controls }).unmet).toEqual([
      'no agreement on a case left out can be worked out',
    ]);
  });
});

describe('the plateau, and the shift, at their edges', () => {
  it('does not let a second peak far away widen the range of the best thresholds', () => {
    const rows = sweep([]).map((row, i) => ({
      ...row,
      balanced: i === 4 || i === 5 || i === 16 ? 1 : 0.5,
    }));
    const best = bestThreshold(rows);
    expect(best?.low).toBe(0.2);
    expect(best?.high).toBe(0.25);
  });

  it('counts a shift of exactly 0.1 as within the limit', () => {
    expect(
      advice({
        auc: 1,
        balanced: 1,
        maxShift: 0.1,
        controls: { count: 10, opusRejected: 1, jevRejected: 1 },
      }).unmet,
    ).toEqual([]);
  });
});

describe('the agreement on the case left out', () => {
  const base = [
    ...[0.9, 0.85, 0.8, 0.95, 0.7, 0.75].map((s, i) =>
      rec(`case${i % 3}`, s, 'yes'),
    ),
    ...[0.1, 0.2, 0.3, 0.15, 0.25, 0.05].map((s, i) =>
      rec(`case${i % 3}`, s, 'no'),
    ),
  ];

  it('is the pooled balanced agreement of the predictions made on each case by a threshold fitted on the rest', () => {
    const [result] = analyze([
      ...base,
      rec('odd', 0.4, 'yes'),
      rec('odd', 0.45, 'yes'),
      rec('odd', 0.42, 'yes'),
    ]);
    // The three yes of the odd case fall under the threshold fitted without it: 6 of 9 yes, and all 6 no.
    expect(result?.leaveOneCaseOut.heldOut).toBeCloseTo((6 / 9 + 1) / 2, 10);
  });

  it('is 1 for cases that a threshold fitted on the others gets all right', () => {
    expect(analyze(base)[0]?.leaveOneCaseOut.heldOut).toBe(1);
  });

  it('is not worked out when the cases left out hold only one class between them', () => {
    const [result] = analyze([
      rec('a', 0.9, 'yes'),
      rec('b', 0.8, 'yes'),
      rec('c', 0.1, 'no'),
    ]);
    expect(result?.leaveOneCaseOut.heldOut).toBeNull();
  });
});

describe('the run of the best thresholds', () => {
  const row = (threshold: number, balanced: number) => ({
    ...agreement([], threshold),
    threshold,
    balanced,
  });

  it('reaches to the thresholds around the best one that are within a point, and takes in one exactly a point below', () => {
    const best = bestThreshold([
      row(0, 0.5),
      row(0.05, 0.99),
      row(0.1, 1),
      row(0.15, 0.99),
      row(0.2, 0.5),
    ]);
    expect(best?.low).toBe(0.05);
    expect(best?.high).toBe(0.15);
  });

  it('stops at a threshold more than a point below', () => {
    const best = bestThreshold([
      row(0, 0.5),
      row(0.05, 0.989),
      row(0.1, 1),
      row(0.15, 0.989),
      row(0.2, 0.5),
    ]);
    expect(best?.low).toBe(0.1);
    expect(best?.high).toBe(0.1);
  });
});

describe('the text of a weight that may count', () => {
  it('has no parentheses after it', () => {
    const records = [
      ...Array.from({ length: 25 }, (_, i) => rec(`case${i % 5}`, 0.9, 'yes')),
      ...Array.from({ length: 25 }, (_, i) => rec(`case${i % 5}`, 0.1, 'no')),
      ...Array.from({ length: 10 }, (_, i) =>
        rec(`case${i % 5}`, 0.15, 'no', {
          control: 'answer-swapped',
          expectedFail: [R],
        }),
      ),
    ];
    expect(formatAnalysis(analyze(records))).toContain(
      '\n  weight: may count\n',
    );
  });
});

describe('the agreement on the case left out, against a worked example', () => {
  /** The same figure worked out from the exported pieces, fold by fold. */
  const expectedHeldOut = (pairs: Pair[]): number | null => {
    let tp = 0;
    let fn = 0;
    let tn = 0;
    let fp = 0;
    for (const name of new Set(pairs.map((p) => p.case))) {
      const rest = pairs.filter((p) => p.case !== name);
      if (auc(rest) === undefined) continue;
      const threshold = bestThreshold(sweep(rest))?.threshold ?? 0;
      const out = agreement(
        pairs.filter((p) => p.case === name),
        threshold,
      );
      tp += out.tp;
      fn += out.fn;
      tn += out.tn;
      fp += out.fp;
    }
    return tp + fn === 0 || tn + fp === 0
      ? null
      : (tp / (tp + fn) + tn / (tn + fp)) / 2;
  };

  it('is what the folds give, for any answers', () => {
    const answers = fc.array(
      fc.record({
        score: fc.integer({ min: 0, max: 20 }).map((n) => n / 20),
        yes: fc.boolean(),
        case: fc.constantFrom('a', 'b', 'c', 'd'),
      }),
      { minLength: 2, maxLength: 24 },
    );
    fc.assert(
      fc.property(answers, (rows) => {
        const records = rows.map((r) =>
          rec(r.case, r.score, r.yes ? 'yes' : 'no'),
        );
        const pairs = rows.map((r) => pair(r.score, r.yes, r.case));
        const [result] = analyze(records);
        const expected = expectedHeldOut(pairs);
        if (expected === null) {
          expect(result?.leaveOneCaseOut.heldOut).toBeNull();
        } else {
          expect(result?.leaveOneCaseOut.heldOut).toBeCloseTo(expected, 10);
        }
      }),
    );
  });

  it('is not worked out when the cases left out hold only no answers between them', () => {
    const [result] = analyze([
      rec('a', 0.1, 'no'),
      rec('b', 0.2, 'no'),
      rec('c', 0.9, 'yes'),
    ]);
    expect(result?.leaveOneCaseOut.heldOut).toBeNull();
  });
});
