import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passAtK, passHatK } from '../src/report/estimators.js';

/** C(n, k) by the multiplicative formula, exact in BigInt. */
const choose = (n: number, k: number): bigint => {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= k; i++) {
    result = (result * BigInt(n - k + i)) / BigInt(i);
  }
  return result;
};

/** The two estimators in the binomial form of the spec. */
const binomialPassAt = (n: number, c: number, k: number): number =>
  1 - Number(choose(n - c, k)) / Number(choose(n, k));
const binomialPassHat = (n: number, c: number, k: number): number =>
  Number(choose(c, k)) / Number(choose(n, k));

const cell = fc.integer({ min: 1, max: 40 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    c: fc.integer({ min: 0, max: n }),
    k: fc.integer({ min: 1, max: n }),
  }),
);

describe('the estimator table', () => {
  it.each([
    [10, 7, 3, 0.9917, 0.2917],
    [10, 7, 5, 1.0, 0.0833],
    [10, 4, 5, 0.9762, 0.0],
    [10, 0, 3, 0.0, 0.0],
    [10, 10, 3, 1.0, 1.0],
    [10, 6, 1, 0.6, 0.6],
  ])('n=%i c=%i k=%i gives pass@k %f and pass^k %f', (n, c, k, at, hat) => {
    expect(passAtK(n, c, k)).toBeCloseTo(at, 4);
    expect(passHatK(n, c, k)).toBeCloseTo(hat, 4);
  });
});

describe('the estimators, for any valid cell', () => {
  it('lie in [0, 1]', () => {
    fc.assert(
      fc.property(cell, ({ n, c, k }) => {
        for (const value of [passAtK(n, c, k), passHatK(n, c, k)]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('bound the pass rate: pass^k <= c/n <= pass@k', () => {
    fc.assert(
      fc.property(cell, ({ n, c, k }) => {
        const rate = c / n;
        expect(passHatK(n, c, k)).toBeLessThanOrEqual(rate + 1e-12);
        expect(passAtK(n, c, k)).toBeGreaterThanOrEqual(rate - 1e-12);
      }),
    );
  });

  it('move with k: pass@k never falls and pass^k never rises as k grows', () => {
    fc.assert(
      fc.property(cell, ({ n, c, k }) => {
        fc.pre(k < n);
        expect(passAtK(n, c, k + 1)).toBeGreaterThanOrEqual(
          passAtK(n, c, k) - 1e-12,
        );
        expect(passHatK(n, c, k + 1)).toBeLessThanOrEqual(
          passHatK(n, c, k) + 1e-12,
        );
      }),
    );
  });

  it('equal c/n at k = 1', () => {
    fc.assert(
      fc.property(cell, ({ n, c }) => {
        expect(passAtK(n, c, 1)).toBeCloseTo(c / n, 10);
        expect(passHatK(n, c, 1)).toBeCloseTo(c / n, 10);
      }),
    );
  });

  it('are 0 when nothing passed and 1 when everything passed', () => {
    fc.assert(
      fc.property(cell, ({ n, k }) => {
        expect(passAtK(n, 0, k)).toBe(0);
        expect(passHatK(n, 0, k)).toBe(0);
        expect(passAtK(n, n, k)).toBe(1);
        expect(passHatK(n, n, k)).toBeCloseTo(1, 12);
      }),
    );
  });

  it('equal the binomial form of the spec', () => {
    fc.assert(
      fc.property(cell, ({ n, c, k }) => {
        expect(passAtK(n, c, k)).toBeCloseTo(binomialPassAt(n, c, k), 9);
        expect(passHatK(n, c, k)).toBeCloseTo(binomialPassHat(n, c, k), 9);
      }),
    );
  });
});

describe('invalid cells', () => {
  it('reject a k above n with a message that names n and k', () => {
    expect(() => passAtK(4, 2, 5)).toThrow(/n.*4.*k.*5|k.*5.*n.*4/);
    expect(() => passHatK(4, 2, 5)).toThrow(/k.*5/);
  });

  it('reject a c above n', () => {
    expect(() => passAtK(4, 5, 1)).toThrow(/c/);
    expect(() => passHatK(4, 5, 1)).toThrow(/c/);
  });

  it.each([
    [0, 0, 1],
    [4, -1, 1],
    [4, 2, 0],
    [4.5, 2, 1],
    [4, 2.5, 1],
    [4, 2, 1.5],
    [Number.NaN, 0, 1],
  ])(
    'reject n=%s c=%s k=%s, which are not whole counts in range',
    (n, c, k) => {
      expect(() => passAtK(n, c, k)).toThrow(RangeError);
      expect(() => passHatK(n, c, k)).toThrow(RangeError);
    },
  );
});
