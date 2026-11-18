/** The value of a JSON text, or `null` when the text is not JSON. The text `null` gives `null` too, and no caller needs to tell them apart. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A JSON object: not null, not a list. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A number that is neither NaN nor infinite. */
export const finite = (value: unknown): value is number =>
  Number.isFinite(value);

/** Text that spells a decimal number: a sign, digits with an optional point, an optional exponent. A copy of `NUMBER_TEXT` in `packages/cli/src/tools/lenientArgs.ts`: the evals judge the built CLI from outside and do not import it. Change both together. */
const NUMBER_TEXT = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * The number a tool argument holds: a finite number, or the text of one. The
 * tools read both, and so must the checks, or they would fail a run for
 * sending what the tool asks of a weaker model. Hex, `Infinity` and a number
 * too large to hold are not numbers, as for the tools.
 */
export const numberOf = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && NUMBER_TEXT.test(value.trim())
        ? Number(value)
        : undefined;
  return finite(number) ? number : undefined;
};
