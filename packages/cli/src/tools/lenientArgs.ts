import { z } from 'zod';

/**
 * Argument types for a model that fills in a tool call loosely: a number or a
 * boolean sent as text. Each is read at the boundary, and a value that cannot
 * be read gets an error that says what was sent and what to send.
 */

const shown = (value: unknown): string =>
  JSON.stringify(value) ?? String(value);

const flagError = (input: unknown): string =>
  `must be true or false, sent as a boolean or as the text "true" or "false"; got ${shown(input)}.`;

/**
 * A boolean, or the text "true" or "false" in any letter case. Weaker models,
 * nemotron among them, send text for a boolean, and spell it "True" or "False".
 * Nothing else is read as one, and the error says what to send. The text is
 * lower-cased and compared, never matched with a case-folding pattern: that
 * would read "falſe" (long s) as false.
 */
export const flag = z
  .union([z.boolean(), z.string()], {
    error: (issue) => flagError(issue.input),
  })
  .transform((value, context) => {
    if (typeof value === 'boolean') {
      return value;
    }
    const text = value.toLowerCase();
    if (text === 'true' || text === 'false') {
      return text === 'true';
    }
    context.issues.push({
      // Stryker disable next-line StringLiteral: equivalent because an empty code does not type-check
      code: 'custom',
      input: value,
      message: flagError(value),
    });
    return z.NEVER;
  });

/** Text that spells a decimal number: a sign, digits with an optional point, an optional exponent. Hex, `Infinity` and thousands separators are not numbers here. The evals package keeps a copy in `packages/evals/src/json.ts`: change both together. */
const NUMBER_TEXT = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

const numberOfText = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) {
    return undefined;
  }
  // "1e999" spells a number too large to hold. A real number is never infinite.
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
};

/**
 * A number, or the text of one. `what` says what the value must be, so that
 * the error tells the model what to send. A value that is neither a number nor
 * numeric text, and a number that fails `accepts`, get the same error.
 */
export const numeric = (what: string, accepts: (value: number) => boolean) => {
  const error = (input: unknown): string =>
    `must be ${what}; got ${shown(input)}.`;
  return z
    .union([z.number(), z.string()], { error: (issue) => error(issue.input) })
    .transform((value, context) => {
      // Text that is no number reads as NaN, which no `accepts` takes.
      const number =
        (typeof value === 'number' ? value : numberOfText(value)) ?? Number.NaN;
      if (accepts(number)) {
        return number;
      }
      context.issues.push({
        // Stryker disable next-line StringLiteral: equivalent because an empty code does not type-check
        code: 'custom',
        input: value,
        message: error(value),
      });
      return z.NEVER;
    });
};

export const NUMERIC_NOTE =
  'A number; numeric text such as "3" is read as one.';

export const FLAG_NOTE =
  'true or false, as a boolean or as the text "true" or "false" in any letter case.';
