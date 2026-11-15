import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  matchesCost,
  matchesCount,
  matchesPrice,
} from '../src/checks/figures.js';

describe('a price', () => {
  it.each([
    ['The input price is $0.03 per million tokens.', 0.03, true],
    ['input: 0.030, output: 0.14', 0.03, true],
    ['It costs $0.04.', 0.03, false],
    ['It costs 0.3 per million.', 0.03, false],
    ['Priced at 3 USD', 3, true],
    ['nothing numeric here', 0.03, false],
  ])('in %j for %s matches: %s', (answer, expected, matches) => {
    expect(matchesPrice(answer, expected)).toBe(matches);
  });

  it('matches the number it is written with, in any spelling of the zeros', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 99 }),
        (whole, cents) => {
          const value = whole + cents / 100;
          expect(
            matchesPrice(`about $${value.toFixed(2)} per million`, value),
          ).toBe(true);
          expect(
            matchesPrice(`about ${value.toFixed(4)} per million`, value),
          ).toBe(true);
        },
      ),
    );
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.double(), (text, value) => {
        expect(typeof matchesPrice(text, value)).toBe('boolean');
      }),
    );
  });
});

describe('a token count', () => {
  it.each([
    ['The window is 131,072 tokens.', 131072, true],
    ['The window is 131072 tokens.', 131072, true],
    ['a 131k window', 131072, true],
    ['a 131K window', 131072, true],
    ['a 128k window', 131072, true],
    ['a 131.1k window', 131072, true],
    ['a 130k window', 131072, false],
    ['a 200k window', 200000, true],
    ['a 1M window', 1000000, true],
    ['a 1M window', 1048576, true],
    ['a 2M window', 1048576, false],
    ['a window of 131,073 tokens', 131072, false],
    ['no count', 131072, false],
  ])('in %j for %s matches: %s', (answer, expected, matches) => {
    expect(matchesCount(answer, expected)).toBe(matches);
  });

  it('matches the count written in full, with or without separators', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), (count) => {
        expect(matchesCount(`${count} tokens`, count)).toBe(true);
        expect(
          matchesCount(`${count.toLocaleString('en-US')} tokens`, count),
        ).toBe(true);
      }),
    );
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.integer(),
        (text, value) => {
          expect(typeof matchesCount(text, value)).toBe('boolean');
        },
      ),
    );
  });
});

describe('a cost', () => {
  it.each([
    ['That is $3.02 a month.', 3, true],
    ['That is $3.00 a month.', 3, true],
    ['That is 3.02 USD a month.', 3, true],
    ['That is $3.04 a month.', 3, false],
    ['That is 3.00 tokens', 3, false],
    ['90 million tokens', 90, false],
    ['$1,234.50', 1234.5, true],
    ['$2.97', 3, true],
    ['$2.96', 3, false],
  ])('in %j for %s matches: %s', (answer, expected, matches) => {
    expect(matchesCost(answer, expected)).toBe(matches);
  });

  it('matches a money amount within one percent and no further', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100000, noNaN: true }),
        (value) => {
          expect(matchesCost(`$${(value * 1.005).toFixed(6)}`, value)).toBe(
            true,
          );
          expect(matchesCost(`$${(value * 1.05).toFixed(6)}`, value)).toBe(
            false,
          );
        },
      ),
    );
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.double(), (text, value) => {
        expect(typeof matchesCost(text, value)).toBe('boolean');
      }),
    );
  });
});

describe('the edges of the matching', () => {
  it('accepts a tiny difference in a large number and refuses a visible one', () => {
    expect(matchesPrice('1000000.00001', 1000000)).toBe(true);
    expect(matchesPrice('1000000.1', 1000000)).toBe(false);
  });

  it('accepts a tiny difference in a number below one, relative to one', () => {
    expect(matchesPrice('0.0010000005', 0.001)).toBe(true);
    expect(matchesPrice('0.0010002', 0.001)).toBe(false);
  });

  it('does not take a price for a token count or a count for a price', () => {
    expect(matchesCount('5 USD', 5)).toBe(false);
    expect(matchesCount('$5', 5)).toBe(true);
    expect(matchesPrice('5k', 5)).toBe(false);
    expect(matchesPrice('5M', 5)).toBe(false);
  });

  it('refuses a cost written in thousands or millions', () => {
    expect(matchesCost('$3k', 3)).toBe(false);
    expect(matchesCost('$3M', 3)).toBe(false);
    expect(matchesCost('$3', 3)).toBe(true);
  });

  it('accepts exactly the tolerance and refuses a cost just beyond it', () => {
    expect(matchesCost('$101', 100)).toBe(true);
    expect(matchesCost('$101.01', 100)).toBe(false);
    expect(matchesCost('$99', 100)).toBe(true);
    expect(matchesCost('$98.99', 100)).toBe(false);
  });

  it('takes a different tolerance when one is given', () => {
    expect(matchesCost('$110', 100, 0.1)).toBe(true);
    expect(matchesCost('$111', 100, 0.1)).toBe(false);
  });

  it('reads a number with no whole part as written', () => {
    expect(matchesPrice('0.5', 0.5)).toBe(true);
    expect(matchesPrice('about 12 dollars', 12)).toBe(true);
  });
});

describe('a cost among several amounts', () => {
  it('matches when any one of them is the cost', () => {
    expect(matchesCost('$5 or $3', 3)).toBe(true);
    expect(matchesCost('$3 or $5', 3)).toBe(true);
    expect(matchesCost('$5 or $9', 3)).toBe(false);
  });
});

describe('a count written as zero thousands', () => {
  it('matches no count', () => {
    expect(matchesCount('0k', 100)).toBe(false);
    expect(matchesCount('0M', 100000)).toBe(false);
    expect(matchesCount('a 0 window', 0)).toBe(true);
  });
});

describe('a number grouped by spaces', () => {
  it.each([
    ['a 131 072 token window', ' '],
    ['a 131\u00a0072 token window', 'no-break space'],
    ['a 131\u202f072 token window', 'narrow no-break space'],
    ['a 131\u2009072 token window', 'thin space'],
  ])('is the count it writes: %j (%s)', (answer) => {
    expect(matchesCount(answer, 131072)).toBe(true);
    expect(matchesCount(answer, 131073)).toBe(false);
  });

  it('is also read as the separate numbers it could be', () => {
    expect(matchesPrice('prices 100 200 300', 100)).toBe(true);
    expect(matchesPrice('prices 100 200 300', 300)).toBe(true);
    expect(matchesPrice('prices 100 200 300', 100200300)).toBe(true);
  });

  it('keeps a decimal part and a currency mark', () => {
    expect(matchesCost('$1 234.50 a month', 1234.5)).toBe(true);
  });

  it('matches any count written with its thousands grouped by a space', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 999_999_999 }), (count) => {
        const grouped = String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        expect(matchesCount(`${grouped} tokens`, count)).toBe(true);
      }),
    );
  });
});
