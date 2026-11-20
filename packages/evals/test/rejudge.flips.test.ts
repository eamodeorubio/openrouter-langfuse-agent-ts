import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatFlip, orderFlips, summaryLine } from '../src/rejudge/flips.js';
import type { Flip, Verdict } from '../src/rejudge/rows.js';

const flip = (over: Partial<Flip> = {}): Flip => ({
  caseId: 'search/single-search',
  model: 'a/b',
  repeat: 3,
  metric: 'wrong-answer',
  before: 'fail',
  after: 'pass',
  ...over,
});

describe('formatFlip', () => {
  it('prints the case, the model, the repeat, the check and the verdicts', () => {
    expect(formatFlip(flip())).toBe(
      'search/single-search | a/b | repeat 3 | wrong-answer | fail → pass',
    );
  });

  it('prints absent for a check that exists on one side only', () => {
    expect(formatFlip(flip({ before: 'absent', after: 'fail' }))).toBe(
      'search/single-search | a/b | repeat 3 | wrong-answer | absent → fail',
    );
  });
});

describe('summaryLine', () => {
  it.each([
    [0, 1, '0 flips in 1 row.'],
    [1, 2, '1 flip in 2 rows.'],
    [2, 420, '2 flips in 420 rows.'],
    [0, 0, '0 flips in 0 rows.'],
  ])('%i flips in %i rows', (flips, rows, line) => {
    expect(summaryLine(flips, rows)).toBe(line);
  });
});

describe('orderFlips', () => {
  const verdict = fc.constantFrom<Verdict>('pass', 'fail', 'absent');
  const flips = fc.array(
    fc.record({
      caseId: fc.constantFrom('a/x', 'a/y', 'b/x'),
      model: fc.constantFrom('m/one', 'm/two'),
      repeat: fc.integer({ min: 0, max: 12 }),
      metric: fc.constantFrom('run-failed', 'wrong-answer'),
      before: verdict,
      after: verdict,
    }),
    { maxLength: 30 },
  );

  it('orders by case, then model, then repeat as a number', () => {
    const ordered = orderFlips([
      flip({ caseId: 'b/x', repeat: 0 }),
      flip({ caseId: 'a/x', model: 'm/two', repeat: 0 }),
      flip({ caseId: 'a/x', model: 'm/one', repeat: 10 }),
      flip({ caseId: 'a/x', model: 'm/one', repeat: 9 }),
    ]);
    expect(ordered.map((f) => [f.caseId, f.model, f.repeat])).toEqual([
      ['a/x', 'm/one', 9],
      ['a/x', 'm/one', 10],
      ['a/x', 'm/two', 0],
      ['b/x', 'a/b', 0],
    ]);
  });

  it('keeps every flip and keeps the order of the checks of one row (property)', () => {
    fc.assert(
      fc.property(flips, (list) => {
        const ordered = orderFlips(list);
        expect(ordered).toHaveLength(list.length);
        expect([...ordered].sort(byText)).toEqual([...list].sort(byText));
        for (let i = 1; i < ordered.length; i++) {
          const [a, b] = [ordered[i - 1] as Flip, ordered[i] as Flip];
          const key = (f: Flip): [string, string, number] => [
            f.caseId,
            f.model,
            f.repeat,
          ];
          const [ka, kb] = [key(a), key(b)];
          const before =
            ka[0] !== kb[0]
              ? ka[0] < kb[0]
              : ka[1] !== kb[1]
                ? ka[1] < kb[1]
                : ka[2] <= kb[2];
          expect(before).toBe(true);
        }
      }),
    );
  });

  it('does not modify the list it was given', () => {
    const list = [flip({ caseId: 'b/x' }), flip({ caseId: 'a/x' })];
    const copy = structuredClone(list);
    orderFlips(list);
    expect(list).toEqual(copy);
  });
});

const byText = (a: Flip, b: Flip): number =>
  JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
