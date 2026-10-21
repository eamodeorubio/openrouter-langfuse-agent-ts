import { describe, expect, it } from 'vitest';
import { calculate } from '../src/tools/calculate.js';
import type { ToolContext } from '../src/tools/types.js';

const context = {} as ToolContext;

describe('calculate arguments', () => {
  it.each([
    [{ expression: '1 + 1' }, true],
    [{ expression: '' }, true],
    [{}, false],
    [{ expression: 5 }, false],
    [{ expression: '1', extra: true }, false],
    [null, false],
    ['1 + 1', false],
  ])('%j is valid: %s', (args, valid) => {
    expect(calculate.parameters.safeParse(args).success).toBe(valid);
  });
});

describe('calculate', () => {
  it('gives the formula and the result of an expression', async () => {
    expect(
      await calculate.run({ expression: '5 * 0.018 + 1 * 0.09' }, context),
    ).toEqual({
      ok: true,
      value: { formula: '5 * 0.018 + 1 * 0.09 = 0.18', result: 0.18 },
    });
  });

  it.each([
    ['10 / (5 - 5)', 'Division by zero.'],
    ['process.exit(1)', 'Unexpected character "p" at position 1.'],
    ['(1 + 2', 'Missing ")" for the "(" at position 1.'],
  ])(
    'gives an error result for %s, not a crash',
    async (expression, message) => {
      expect(await calculate.run({ expression }, context)).toEqual({
        ok: false,
        message,
      });
    },
  );
});
