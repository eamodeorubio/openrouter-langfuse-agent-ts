import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numberOf } from '../src/json.js';

// The same texts as the tool's own tests (packages/cli/test/searchModels.text.test.ts): the two readers agree.
describe('numberOf', () => {
  it.each([
    [' 3 ', 3],
    ['+3', 3],
    ['-3', -3],
    ['.5', 0.5],
    ['3.', 3],
    ['1e3', 1000],
    ['1E-2', 0.01],
    ['0003', 3],
    ['200000', 200000],
    [200000, 200000],
    [0.5, 0.5],
  ])('reads %j as %s', (value, expected) => {
    expect(numberOf(value)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    'abc',
    '0x10',
    'Infinity',
    'NaN',
    '1,000',
    '1_000',
    '3 tokens',
    '--3',
    '1e',
    'true',
    '1e999',
    '-1e999',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    true,
    null,
    undefined,
    [3],
    { n: 3 },
  ])('reads %j as no number', (value) => {
    expect(numberOf(value)).toBeUndefined();
  });

  it('reads the text of any finite number, padded or not, as that number', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom('', ' ', '\t'),
        (value, padding) => {
          const read = numberOf(`${padding}${value}${padding}`);
          // Not `Object.is`: the text of -0 is "0".
          expect(Math.abs((read ?? Number.NaN) - value)).toBe(0);
        },
      ),
    );
  });

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => numberOf(value)).not.toThrow();
      }),
    );
  });
});
