import { z } from 'zod';
import { evaluate } from './arithmetic.js';
import type { Tool } from './types.js';

const parameters = z
  .object({
    expression: z
      .string()
      .describe(
        'The arithmetic to compute: decimal numbers, `+`, `-`, `*`, `/` and parentheses, such as `5 * 0.018 + 1 * 0.09`. Nothing else is accepted.',
      ),
  })
  .strict();

export const calculate: Tool<typeof parameters> = {
  name: 'calculate',
  description:
    'Compute an arithmetic expression. Returns the formula and its result, rounded to 12 significant digits. Use it for every cost estimate, for example millions of tokens times the price per million tokens.',
  parameters,
  async run({ expression }) {
    const outcome = evaluate(expression);
    return outcome.ok
      ? {
          ok: true,
          value: { formula: outcome.formula, result: outcome.result },
        }
      : { ok: false, message: outcome.message };
  },
};
