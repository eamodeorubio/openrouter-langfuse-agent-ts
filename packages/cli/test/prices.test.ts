import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { perMillionTokens } from '../src/tools/prices.js';

describe('perMillionTokens', () => {
  it.each([
    ['0.000003', 3],
    ['0.0000001', 0.1],
    ['0.0000015', 1.5],
    ['0.00000007', 0.07],
    ['0.000000018', 0.018],
    ['0', 0],
    ['0.0', 0],
    ['1', 1_000_000],
    ['0.5', 500_000],
  ])(
    'turns the API price %s into %s dollars per million tokens',
    (price, expected) => {
      expect(perMillionTokens(price)).toBe(expected);
    },
  );

  it.each([
    ['-1'],
    ['-0.000003'],
    ['abc'],
    [''],
    [' '],
    ['1e-6'],
    ['0x10'],
    ['.5'],
    ['1.'],
    ['0.000003 '],
    ['Infinity'],
    ['NaN'],
  ])('turns the unusable price %j into null', (price) => {
    expect(perMillionTokens(price)).toBeNull();
  });

  it.each([[undefined], [null], [3], [{}], [['0.1']]])(
    'turns the non-string %j into null',
    (price) => {
      expect(perMillionTokens(price)).toBeNull();
    },
  );

  it('keeps whole dollars per million exact, whatever the value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999 }), (dollars) => {
        const perToken = `0.${String(dollars).padStart(6, '0')}`;
        expect(perMillionTokens(perToken)).toBe(dollars);
      }),
    );
  });

  it('shifts the decimal point six places and nothing else', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.stringMatching(/^[0-9]{1,6}$/),
        (dollars, fraction) => {
          const perToken = `0.${String(dollars).padStart(6, '0')}${fraction}`;
          expect(perMillionTokens(perToken)).toBe(
            Number(`${dollars}.${fraction}`),
          );
        },
      ),
    );
  });

  it('gives a finite non-negative number for every plain decimal string', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{1,12}(\.[0-9]{1,18})?$/),
        (price) => {
          const value = perMillionTokens(price);
          expect(value).not.toBeNull();
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('never throws, and gives null or a non-negative number, for any input', () => {
    fc.assert(
      fc.property(fc.anything(), (price) => {
        const value = perMillionTokens(price);
        expect(value === null || value >= 0).toBe(true);
      }),
    );
  });
});
