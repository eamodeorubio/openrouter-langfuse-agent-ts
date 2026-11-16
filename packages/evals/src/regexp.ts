/** The text with every character that a regular expression reads as syntax escaped, so that it matches itself. */
export const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
