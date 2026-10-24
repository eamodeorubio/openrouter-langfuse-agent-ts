import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/text.js';
import { createMask, REDACTED } from '../src/tracing/mask.js';

const redactor = (secrets: (string | undefined)[]) =>
  createRedactor(secrets, REDACTED);

describe('createRedactor', () => {
  it('replaces every occurrence of every secret with [REDACTED]', () => {
    const redact = redactor(['sk-1', 'pk-2']);
    expect(redact('sk-1 and pk-2 and sk-1')).toBe(
      '[REDACTED] and [REDACTED] and [REDACTED]',
    );
    expect(REDACTED).toBe('[REDACTED]');
  });

  it('replaces a secret that holds another whole, whatever the order of the list', () => {
    expect(redactor(['abc', 'abcdef'])('x abcdef y')).toBe('x [REDACTED] y');
    expect(redactor(['abcdef', 'abc'])('x abcdef y')).toBe('x [REDACTED] y');
  });

  it('ignores an empty secret instead of replacing every gap', () => {
    expect(redactor(['', 'k'])('a k b')).toBe('a [REDACTED] b');
  });

  it('replaces a secret as it sits inside a JSON string, escapes and all', () => {
    const secret = 'a"b\\c';
    const json = JSON.stringify({ note: `the key is ${secret}!` });
    expect(redactor([secret])(json)).toBe('{"note":"the key is [REDACTED]!"}');
  });

  it('skips a secret that is missing', () => {
    expect(redactor([undefined, 'k'])('a k b')).toBe('a [REDACTED] b');
  });

  it('leaves a text with no secret as it is', () => {
    expect(redactor(['k'])('nothing here')).toBe('nothing here');
    expect(redactor([])('nothing here')).toBe('nothing here');
  });

  it('removes every insertion of a secret and nothing else, for any secrets and any text around them', () => {
    // Secrets are upper case; the text around them never is, so a secret can appear only where it was put.
    const secret = fc.stringMatching(/^[A-Z]{4,10}$/);
    const filler = fc.stringMatching(/^[a-z0-9 |"\\]{0,10}$/);
    fc.assert(
      fc.property(
        fc.uniqueArray(secret, { minLength: 1, maxLength: 4 }),
        fc.array(fc.tuple(filler, fc.nat()), { minLength: 1, maxLength: 8 }),
        (secrets, rest) => {
          let text = '';
          for (const [filling, pick] of rest) {
            text += `${filling}${secrets[pick % secrets.length]}`;
          }
          const out = redactor(secrets)(text);
          for (const s of secrets) {
            expect(out).not.toContain(s);
          }
          expect(out.split(REDACTED)).toHaveLength(rest.length + 1);
          expect(out.replaceAll(REDACTED, '')).toBe(
            rest.map(([filling]) => filling).join(''),
          );
        },
      ),
    );
  });

  it('is idempotent: redacting twice is redacting once', () => {
    const secret = fc.stringMatching(/^[a-z0-9-]{3,10}$/);
    fc.assert(
      fc.property(
        fc.array(secret, { maxLength: 3 }),
        fc.string(),
        (secrets, text) => {
          const redact = redactor(secrets);
          expect(redact(redact(text))).toBe(redact(text));
        },
      ),
    );
  });
});

describe('createMask', () => {
  const mask = createMask(['sk-secret']);

  it('masks the text of a value', () => {
    expect(mask({ data: '"key sk-secret"' })).toBe('"key [REDACTED]"');
  });

  it('does not cut an escape sequence in half when a secret is a single letter', () => {
    expect(createMask(['n'])({ data: 'x\ny' })).toBe('x\ny');
  });

  it('masks the keys of a decoded value as well as its values', () => {
    expect(
      mask({ data: { 'sk-secret': 1, nested: { 'sk-secret': 'x' } } }),
    ).toEqual({
      '[REDACTED]': 1,
      nested: { '[REDACTED]': 'x' },
    });
  });

  it('keeps the structure of a decoded value whatever the secret is made of', () => {
    expect(
      createMask(['n', 'tru', 'null'])({
        data: { a: [true, null, 'x'], n: 'n', b: 'tru' },
      }),
    ).toEqual({
      a: [true, null, 'x'],
      '[REDACTED]': '[REDACTED]',
      b: '[REDACTED]',
    });
  });

  it('gives back a value that is not there, as it is', () => {
    expect(mask({ data: undefined })).toBeUndefined();
    expect(mask({ data: null })).toBeNull();
  });

  it('masks a value that arrives decoded, and gives it back decoded', () => {
    expect(
      mask({ data: { a: 'sk-secret', b: [1, 'x sk-secret'], c: 2 } }),
    ).toEqual({ a: '[REDACTED]', b: [1, 'x [REDACTED]'], c: 2 });
  });

  it('leaves numbers and booleans as they are', () => {
    expect(mask({ data: 5 })).toBe(5);
    expect(mask({ data: true })).toBe(true);
  });
});
