const PER_MILLION_PLACES = 6;
const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Turns the API's price per token, a decimal string, into dollars per million
 * tokens. The decimal point is moved in the text, never by multiplying, so
 * `0.000003` gives exactly `3`. Anything that is not a plain non-negative
 * decimal string, such as the `-1` of a routing model, gives `null`.
 */
export const perMillionTokens = (price: unknown): number | null => {
  if (typeof price !== 'string') {
    return null;
  }
  const match = PLAIN_DECIMAL.exec(price);
  if (!match) {
    return null;
  }
  // The pattern guarantees the whole part; only the fraction may be missing.
  const whole = match[1] as string;
  const digits = (match[2] ?? '').padEnd(PER_MILLION_PLACES, '0');
  // A shifted text that ends in the point, such as `5.`, is still a number.
  return Number(
    `${whole}${digits.slice(0, PER_MILLION_PLACES)}.${digits.slice(PER_MILLION_PLACES)}`,
  );
};
