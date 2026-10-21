const MAX_LINE_LENGTH = 200;

/** The text on one line, whitespace collapsed, cut with an ellipsis past 200 characters. */
export const oneLine = (text: string): string => {
  const characters = [...text.replace(/\s+/g, ' ').trim()];
  return characters.length > MAX_LINE_LENGTH
    ? `${characters.slice(0, MAX_LINE_LENGTH).join('')}…`
    : characters.join('');
};

/** The text with every occurrence of the API key replaced. The one place that keeps the key off the screen and away from the model. */
export const redactKey = (text: string, apiKey: string | undefined): string =>
  apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
