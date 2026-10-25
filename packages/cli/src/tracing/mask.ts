import { createRedactor } from '../text.js';

export const REDACTED = '[REDACTED]';

/**
 * What is replaced by its shape: a bearer token, a key as OpenRouter and
 * Langfuse make them, an email address. Few and tight on purpose: a pattern
 * that is too broad would eat the tool results a trace exists to keep. Every
 * run of characters is bounded, so that a huge unbroken text cannot make the
 * match quadratic.
 */
const PATTERNS: readonly RegExp[] = [
  /\bBearer\s{1,16}[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:sk-or|sk-lf|pk-lf)-[A-Za-z0-9_-]{4,}/g,
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}/g,
];

/** Replaces each secret in a text, then whatever has the shape of a credential or an address, with `[REDACTED]`. */
export const redactorFor = (secrets: readonly (string | undefined)[]) => {
  const literally = createRedactor(secrets, REDACTED);
  return (text: string): string =>
    PATTERNS.reduce(
      (rest, pattern) => rest.replace(pattern, REDACTED),
      literally(text),
    );
};

/**
 * The step the processor puts every exported input, output and metadata value
 * through. Langfuse gives it the text of a value, or the value decoded. A
 * decoded value is walked, strings and keys alike, so that a secret can never
 * break the structure around it.
 */
export const createMask = (secrets: readonly (string | undefined)[]) => {
  const redact = redactorFor(secrets);
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return redact(value);
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [redact(key), walk(inner)]),
      );
    }
    return value;
  };
  return ({ data }: { data: unknown }): unknown => walk(data);
};
