import { createRedactor } from '../text.js';

export const REDACTED = '[REDACTED]';

/** Replaces each secret in a text with `[REDACTED]`. */
export const redactorFor = (secrets: readonly (string | undefined)[]) =>
  createRedactor(secrets, REDACTED);

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
