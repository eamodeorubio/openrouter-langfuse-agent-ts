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
