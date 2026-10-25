const MAX_LINE_LENGTH = 200;

/** The text on one line, whitespace collapsed, cut with an ellipsis past 200 characters. */
export const oneLine = (text: string): string => {
  const characters = [...text.replace(/\s+/g, ' ').trim()];
  return characters.length > MAX_LINE_LENGTH
    ? `${characters.slice(0, MAX_LINE_LENGTH).join('')}…`
    : characters.join('');
};

/** The text as it sits inside a JSON string. */
const escaped = (text: string): string => JSON.stringify(text).slice(1, -1);

/**
 * The one place that keeps secrets off the screen, away from the model and out
 * of the trace. It replaces each secret, plain and as JSON escapes it, with
 * `marker`; longest first, so that a secret holding another is replaced whole.
 * A secret that is missing or empty is skipped.
 */
export const createRedactor = (
  secrets: readonly (string | undefined)[],
  marker: string,
) => {
  const needles = secrets
    .filter((secret): secret is string => secret !== undefined && secret !== '')
    .flatMap((secret) => [secret, escaped(secret)])
    .sort((a, b) => b.length - a.length);
  return (text: string): string =>
    needles.reduce((rest, needle) => rest.replaceAll(needle, marker), text);
};

const SCREEN_MARKER = '[redacted]';

/** The text with every occurrence of the API key replaced. */
export const redactKey = (text: string, apiKey: string | undefined): string =>
  createRedactor([apiKey], SCREEN_MARKER)(text);

/** The text with every occurrence of each secret replaced. */
export const redactAll = (
  text: string,
  secrets: readonly (string | undefined)[],
): string => createRedactor(secrets, SCREEN_MARKER)(text);
