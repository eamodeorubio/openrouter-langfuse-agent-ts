import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate, MAX_LENGTH } from '../src/tools/arithmetic.js';

const value = (expression: string): number => {
  const outcome = evaluate(expression);
  if (!outcome.ok) {
    throw new Error(outcome.message);
  }
  return outcome.result;
};
const message = (expression: string): string => {
  const outcome = evaluate(expression);
  if (outcome.ok) {
    throw new Error(`accepted ${expression}`);
  }
  return outcome.message;
};

describe('evaluate: what it accepts', () => {
  it.each([
    ['5 * 0.018 + 1 * 0.09', 0.18],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 - 4 - 3', 3],
    ['100 / 5 / 2', 10],
    ['2 * 3 + 4 * 5', 26],
    ['-5 + 2', -3],
    ['(-3) * 2', -6],
    ['2 - -3', 5],
    ['2 * -3', -6],
    ['+4', 4],
    ['- - 4', 4],
    ['-(1 + 2)', -3],
    [' 1+1 ', 2],
    ['1+2*3-4/2', 5],
    ['007 + 1', 8],
    ['0', 0],
    ['3 * 0', 0],
    ['0 * 3 + 2', 2],
    ['1 / 4', 0.25],
    ['((((1))))', 1],
    ['3.14159 * 2', 6.28318],
    ['1000000 * 0.000003', 3],
  ])('%s gives %s', (expression, expected) => {
    expect(value(expression)).toBe(expected);
  });

  it('applies the usual precedence and goes left to right among equals', () => {
    expect(value('8 - 2 - 1')).toBe(5);
    expect(value('64 / 4 / 2')).toBe(8);
    expect(value('2 + 3 * 4 - 6 / 2')).toBe(11);
  });

  it('accepts 32 levels of parentheses and an expression of 200 characters', () => {
    expect(value(`${'('.repeat(32)}7${')'.repeat(32)}`)).toBe(7);
    expect(value('1'.repeat(200))).toBe(1.11111111111e199);
  });
});

describe('evaluate: what it rejects, and why', () => {
  it.each([
    ['abc', 'Unexpected character "a" at position 1.'],
    ['2 + abc', 'Unexpected character "a" at position 5.'],
    ['Math.PI', 'Unexpected character "M" at position 1.'],
    ['process.exit()', 'Unexpected character "p" at position 1.'],
    ['2 ** 3', 'Unexpected character "*" at position 4.'],
    ['7 % 2', 'Unexpected character "%" at position 3.'],
    ['2 ^ 3', 'Unexpected character "^" at position 3.'],
    ['1e3', 'Unexpected character "e" at position 2.'],
    ['1_000', 'Unexpected character "_" at position 2.'],
    ['1,000', 'Unexpected character "," at position 2.'],
    ['.5', 'Unexpected character "." at position 1.'],
    ['5.', 'Unexpected character "." at position 2.'],
    ['1.2.3', 'Unexpected character "." at position 4.'],
    ['1; 2', 'Unexpected character ";" at position 2.'],
    ['`2`', 'Unexpected character "`" at position 1.'],
    [
      'constructor.constructor("return 1")()',
      'Unexpected character "c" at position 1.',
    ],
    ['2 3', 'Unexpected character "3" at position 3.'],
    ['2 (3)', 'Unexpected character "(" at position 3.'],
    ['(1 2)', 'Unexpected character "2" at position 4.'],
    ['(1 + 2 3)', 'Unexpected character "3" at position 8.'],
    ['1 + 2)', 'Unexpected character ")" at position 6.'],
    ['()', 'Unexpected character ")" at position 2.'],
    ['*2', 'Unexpected character "*" at position 1.'],
    ['\t', 'Unexpected character "\\t" at position 1.'],
    ['1\t+ 2', 'Unexpected character "\\t" at position 2.'],
    ['1\n+ 2', 'Unexpected character "\\n" at position 2.'],
    ['1\r+ 2', 'Unexpected character "\\r" at position 2.'],
    ['1\u0000+ 2', 'Unexpected character "\\u0000" at position 2.'],
    ['1\u2028+ 2', 'Unexpected character "\\u2028" at position 2.'],
    ['1\u007f+ 2', 'Unexpected character "\\u007f" at position 2.'],
    ['１ + 2', 'Unexpected character "１" at position 1.'],
  ])('%j: %s', (expression, expected) => {
    expect(message(expression)).toBe(expected);
  });

  it.each([
    ['', 'The expression is empty.'],
    ['   ', 'The expression is empty.'],
    ['1 +', 'The expression ends where a number or "(" is expected.'],
    ['+', 'The expression ends where a number or "(" is expected.'],
    ['2 * (', 'The expression ends where a number or "(" is expected.'],
    ['(1 + 2', 'Missing ")" for the "(" at position 1.'],
    ['2 * (3 + (4)', 'Missing ")" for the "(" at position 5.'],
  ])('%j: %s', (expression, expected) => {
    expect(message(expression)).toBe(expected);
  });

  it.each([
    ['5 / 0'],
    ['1 / (2 - 2)'],
    ['0 / 0'],
    ['3 / 0.0'],
    ['1 + 4 / (1 - 1)'],
  ])('%s is division by zero', (expression) => {
    expect(message(expression)).toBe('Division by zero.');
  });

  it('does not call 0 divided by something a division by zero', () => {
    expect(value('0 / 5')).toBe(0);
  });

  it('names the length limit at 201 characters', () => {
    expect(message('1'.repeat(201))).toBe(
      'The expression is longer than 200 characters.',
    );
  });

  it('names the nesting limit at 33 levels', () => {
    expect(message(`${'('.repeat(33)}7${')'.repeat(33)}`)).toBe(
      'Parentheses are nested deeper than 32 levels.',
    );
  });

  it('checks the length before anything else', () => {
    expect(message(`${'a'.repeat(201)}`)).toBe(
      'The expression is longer than 200 characters.',
    );
  });
});

describe('evaluate: the result', () => {
  it.each([
    ['0.1 + 0.2', 0.3],
    ['1 / 3', 0.333333333333],
    ['2 / 3', 0.666666666667],
    ['0.000003 * 1000000', 3],
    ['0.1 * 3', 0.3],
    ['1.1 * 1.1', 1.21],
    ['100 / 3', 33.3333333333],
    ['123456789012345 + 0', 123456789012000],
  ])('%s is rounded to 12 significant digits: %s', (expression, expected) => {
    expect(value(expression)).toBe(expected);
  });

  it.each([
    ['0.1 + 0.2 - 0.3', 0],
    ['0.1 * 3 - 0.3', 0],
    ['(0.1 + 0.2) * 10', 3],
    ['1.1 * 1.1 - 1.21', 0],
    ['0.7 + 0.1 + 0.2 - 1', 0],
  ])(
    'rounds every step, so the noise of %s does not survive: %s',
    (expression, expected) => {
      expect(value(expression)).toBe(expected);
    },
  );

  it('calls a divisor that is zero after rounding a division by zero', () => {
    expect(message('1 / (0.1 + 0.2 - 0.3)')).toBe('Division by zero.');
    expect(message('5 / (0.1 * 3 - 0.3)')).toBe('Division by zero.');
  });

  it.each([
    ['0.0000001 * 1', '0.0000001 * 1 = 0.0000001'],
    ['1 / 10000000', '1 / 10000000 = 0.0000001'],
    ['1.5 / 10000000', '1.5 / 10000000 = 0.00000015'],
    ['-1 / 10000000', '-1 / 10000000 = -0.0000001'],
    [
      '1000000000000000000000 * 1',
      '1000000000000000000000 * 1 = 1000000000000000000000',
    ],
    [
      '15 * 100000000000000000000',
      '15 * 100000000000000000000 = 1500000000000000000000',
    ],
    ['0.000003 * 0.01', '0.000003 * 0.01 = 0.00000003'],
  ])(
    'writes %s without an exponent, which the grammar would refuse: %s',
    (expression, formula) => {
      const outcome = evaluate(expression);
      expect(outcome.ok && outcome.formula).toBe(formula);
    },
  );

  it('writes the formula with single spaces around binary operators and the result', () => {
    const formula = (expression: string) => {
      const outcome = evaluate(expression);
      return outcome.ok ? outcome.formula : outcome.message;
    };
    expect(formula('5*0.018+1*0.09')).toBe('5 * 0.018 + 1 * 0.09 = 0.18');
    expect(formula('  ( 2+3 )*-4 ')).toBe('(2 + 3) * -4 = -20');
    expect(formula('-(1+2)')).toBe('-(1 + 2) = -3');
    expect(formula('2--3')).toBe('2 - -3 = 5');
    expect(formula('1/4')).toBe('1 / 4 = 0.25');
    expect(formula('+4')).toBe('+4 = 4');
    expect(formula('007+1')).toBe('007 + 1 = 8');
  });

  it('shows zero as 0, never as -0', () => {
    const outcome = evaluate('0 * -1');
    expect(outcome).toEqual({ ok: true, formula: '0 * -1 = 0', result: 0 });
    expect(Object.is((outcome as { result: number }).result, 0)).toBe(true);
  });
});

/** An expression as a tree, to print in many ways and to evaluate without the parser. */
type Tree =
  | { kind: 'num'; text: string }
  | { kind: 'neg'; inner: Tree }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Tree; right: Tree };

const numbers = fc
  .tuple(
    fc.nat(999),
    fc.option(fc.stringMatching(/^[0-9]{1,3}$/), { nil: undefined }),
  )
  .map(
    ([whole, fraction]): Tree => ({
      kind: 'num',
      text: fraction === undefined ? String(whole) : `${whole}.${fraction}`,
    }),
  );

const trees: fc.Arbitrary<Tree> = fc.letrec<{ tree: Tree }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    numbers,
    tie('tree').map((inner): Tree => ({ kind: 'neg', inner })),
    fc
      .tuple(
        fc.constantFrom('+', '-', '*', '/') as fc.Arbitrary<
          '+' | '-' | '*' | '/'
        >,
        tie('tree'),
        tie('tree'),
      )
      .map(([op, left, right]): Tree => ({ kind: 'bin', op, left, right })),
  ),
})).tree;

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 } as const;

/** Prints the tree so that it parses back to the same tree; `spacing` and `extra` vary how. */
const print = (
  tree: Tree,
  spaces: () => string,
  extra: () => boolean,
): string => {
  switch (tree.kind) {
    case 'num':
      return tree.text;
    case 'neg': {
      const inner = print(tree.inner, spaces, extra);
      return tree.inner.kind === 'bin'
        ? `-${spaces()}(${inner})`
        : `-${spaces()}${inner}`;
    }
    case 'bin': {
      const side = (child: Tree, right: boolean): string => {
        const text = print(child, spaces, extra);
        const needs =
          child.kind === 'bin' &&
          (PRECEDENCE[child.op] < PRECEDENCE[tree.op] ||
            (right && PRECEDENCE[child.op] === PRECEDENCE[tree.op]));
        return needs || extra() ? `(${spaces()}${text}${spaces()})` : text;
      };
      return `${side(tree.left, false)}${spaces()}${tree.op}${spaces()}${side(tree.right, true)}`;
    }
  }
};

/** What a calculator that works to 12 significant digits keeps after each step. */
const round = (value: number): number => Number(value.toPrecision(12));

/** The value of the tree by plain arithmetic, rounded after each step, or null when a division by zero happens. */
const oracle = (tree: Tree): number | null => {
  switch (tree.kind) {
    case 'num':
      return Number(tree.text);
    case 'neg': {
      const inner = oracle(tree.inner);
      return inner === null ? null : -inner;
    }
    case 'bin': {
      const left = oracle(tree.left);
      const right = oracle(tree.right);
      if (left === null || right === null) {
        return null;
      }
      switch (tree.op) {
        case '+':
          return round(left + right);
        case '-':
          return round(left - right);
        case '*':
          return round(left * right);
        case '/':
          return right === 0 ? null : round(left / right);
      }
    }
  }
};

describe('evaluate: a bug is not a message', () => {
  it('lets an unexpected failure through instead of showing it to the model as a rejection', () => {
    const hostile = {
      get length(): number {
        throw new RangeError('bug');
      },
    } as unknown as string;
    expect(() => evaluate(hostile)).toThrow(new RangeError('bug'));
  });
});

describe('evaluate: properties', () => {
  it('agrees with plain arithmetic on any expression, however it is spaced and bracketed', () => {
    fc.assert(
      fc.property(
        trees,
        fc.array(fc.constantFrom('', ' ', '  '), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        (tree, gaps, brackets) => {
          let g = 0;
          let b = 0;
          const text = print(
            tree,
            () => gaps[g++ % gaps.length] as string,
            () => brackets[b++ % brackets.length] as boolean,
          );
          fc.pre(
            text.length <= 200 &&
              !text.includes('((((((((((((((((((((((((((((((((('),
          );
          const expected = oracle(tree);
          const outcome = evaluate(text);
          if (expected === null) {
            expect(outcome).toEqual({
              ok: false,
              message: 'Division by zero.',
            });
          } else {
            expect(outcome.ok).toBe(true);
            expect((outcome as { result: number }).result).toBe(
              round(expected),
            );
          }
        },
      ),
    );
  });

  it('never throws, and gives a result or a one-line message, for any text', () => {
    const alphabet = fc.stringMatching(/^[0-9+\-*/(). eE_,%a]{0,60}$/);
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: 'binary' }), alphabet),
        (text) => {
          const outcome = evaluate(text);
          if (outcome.ok) {
            expect(Number.isFinite(outcome.result)).toBe(true);
          } else {
            expect(outcome.message.length).toBeGreaterThan(0);
            expect(outcome.message).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('gives a finite number whenever it gives a number: the length limit keeps every value far below the largest double', () => {
    // Two operands and two spaces and an operator fill the limit exactly.
    const width = Math.floor((MAX_LENGTH - 3) / 2);
    const digits = fc.stringMatching(
      new RegExp(`^[1-9][0-9]{0,${width - 1}}$`),
    );
    const tiny = fc.stringMatching(new RegExp(`^0\\.0{0,${width - 4}}[1-9]$`));
    fc.assert(
      fc.property(
        digits,
        digits,
        fc.constantFrom('*', '+', '-'),
        (a, b, op) => {
          const outcome = evaluate(`${a} ${op} ${b}`);
          expect(outcome.ok && Number.isFinite(outcome.result)).toBe(true);
        },
      ),
    );
    fc.assert(
      fc.property(digits, tiny, (a, b) => {
        const outcome = evaluate(`${a} / ${b}`);
        expect(outcome.ok && Number.isFinite(outcome.result)).toBe(true);
      }),
    );
  });

  it('writes the result in plain decimal, which parses back to the same number', () => {
    const zeros = fc.nat(150);
    const digits = fc.stringMatching(/^[1-9][0-9]{0,11}$/);
    fc.assert(
      fc.property(zeros, digits, (k, d) => {
        for (const expression of [
          `0.${'0'.repeat(k)}${d} * 1`,
          `${d}${'0'.repeat(k)} * 1`,
        ]) {
          const outcome = evaluate(expression);
          if (!outcome.ok) {
            throw new Error(outcome.message);
          }
          const shown = outcome.formula.split(' = ')[1] as string;
          expect(shown).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
          expect(Number(shown)).toBe(outcome.result);
        }
      }),
    );
  });

  it('rejects any text with a character outside the grammar', () => {
    const outside = fc.constantFrom(
      'a',
      'Z',
      '_',
      ',',
      '%',
      '^',
      '&',
      '"',
      "'",
      '\\',
      '=',
      '<',
      '[',
      'e',
      '\t',
      '\n',
      'é',
      '１',
    );
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9+\-*/(). ]{0,20}$/),
        outside,
        fc.stringMatching(/^[0-9+\-*/(). ]{0,20}$/),
        (before, bad, after) => {
          expect(evaluate(`${before}${bad}${after}`).ok).toBe(false);
        },
      ),
    );
  });
});
