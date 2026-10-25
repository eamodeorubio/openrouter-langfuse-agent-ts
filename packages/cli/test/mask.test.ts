import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/text.js';
import { createMask, REDACTED, redactorFor } from '../src/tracing/mask.js';

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

describe('redactorFor, by pattern', () => {
  const redact = redactorFor([]);

  it.each([
    [
      'an email address',
      'mail me at a.b+c@example.co.uk now',
      'mail me at [REDACTED] now',
    ],
    [
      'a bearer token',
      'Authorization: Bearer abcdef0123456789ABCDEF.xyz-_~+/=',
      'Authorization: [REDACTED]',
    ],
    [
      'a lower case bearer',
      'header bearer abcdef0123456789abcdef',
      'header [REDACTED]',
    ],
    [
      'an OpenRouter key shape',
      'key sk-or-v1-0123456789abcdef used',
      'key [REDACTED] used',
    ],
    ['a Langfuse secret key shape', 'sk-lf-test-key', '[REDACTED]'],
    ['a Langfuse public key shape', 'pk-lf-test-key, ok', '[REDACTED], ok'],
    ['two at once', 'a@b.io and c@d.io', '[REDACTED] and [REDACTED]'],
  ])('replaces %s', (_name, text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it.each([
    'a bearer token is a credential',
    'Bearer short',
    'user@localhost',
    'a@b',
    'sk-ant-abcdef',
    'the price is $0.15 at 5 * 0.15',
    'slug openai/gpt-oss-20b:free',
    '',
  ])('leaves %j as it is', (text) => {
    expect(redact(text)).toBe(text);
  });

  it.each([
    ['two spaces', 'Bearer  abcdef0123456789abcd'],
    ['a tab', 'Bearer\tabcdef0123456789abcd'],
    ['a newline', 'Bearer\nabcdef0123456789abcd'],
  ])('replaces a bearer token after %s', (_name, text) => {
    expect(redact(text)).toBe('[REDACTED]');
  });

  it('replaces a bearer token of 16 characters and leaves one of 15', () => {
    expect(redact(`Bearer ${'a'.repeat(16)}`)).toBe('[REDACTED]');
    expect(redact(`Bearer ${'a'.repeat(15)}`)).toBe(`Bearer ${'a'.repeat(15)}`);
  });

  it('replaces a key shape with 4 characters after the prefix and leaves one with 3', () => {
    expect(redact('sk-or-abcd')).toBe('[REDACTED]');
    expect(redact('sk-or-abc')).toBe('sk-or-abc');
  });

  it('leaves an address whose last part is one letter', () => {
    expect(redact('a@b.c')).toBe('a@b.c');
    expect(redact('a@b.co')).toBe('[REDACTED]');
  });

  it('finishes quickly on a huge text with nothing to replace, whatever its shape', () => {
    const shapes = [
      'a'.repeat(200_000),
      'a.'.repeat(100_000),
      `Bearer${' '.repeat(200_000)}`,
      'Bearer '.repeat(30_000),
      'sk-or-'.repeat(30_000),
      `${'a'.repeat(100_000)}@${'b'.repeat(100_000)}`,
    ];
    for (const text of shapes) {
      const started = performance.now();
      redact(text);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });

  it('still replaces the end of an address whose local part is over 64 characters, so that no at sign is left', () => {
    const out = redact(`${'a'.repeat(70)}@example.com`);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('@');
  });

  it('applies the literal secrets and the patterns together', () => {
    expect(
      redactorFor(['hunter2'])(
        'hunter2 mailed a@b.io with Bearer abcdef0123456789abcd',
      ),
    ).toBe('[REDACTED] mailed [REDACTED] with [REDACTED]');
  });

  const filler = fc.stringMatching(/^[a-z0-9 ,.:;!?"|\\]{0,12}$/);
  const email = fc
    .tuple(
      fc.stringMatching(/^[a-z0-9]{1,8}$/),
      fc.stringMatching(/^[a-z]{2,8}$/),
    )
    .map(([user, host]) => `${user}@${host}.com`);
  const bearer = fc
    .stringMatching(/^[A-Za-z0-9]{16,30}$/)
    .map((token) => `Bearer ${token}`);
  const keyShape = fc
    .tuple(
      fc.constantFrom('sk-or-', 'sk-lf-', 'pk-lf-'),
      fc.stringMatching(/^[A-Za-z0-9-]{8,20}$/),
    )
    .map(([prefix, rest]) => `${prefix}${rest}`);

  it('removes every insertion of an email, a bearer token or a key shape, and nothing else', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(filler, fc.oneof(email, bearer, keyShape)), {
          minLength: 1,
          maxLength: 6,
        }),
        (parts) => {
          const text = parts.map(([f, secret]) => `${f} ${secret}`).join(' ');
          const out = redact(text);
          expect(out.split(REDACTED)).toHaveLength(parts.length + 1);
          expect(out.replaceAll(REDACTED, '')).toBe(
            parts
              .map(([f]) => `${f}  `)
              .join('')
              .replace(/ $/, ''),
          );
        },
      ),
    );
  });

  it('is idempotent, for any text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(redact(redact(text))).toBe(redact(text));
      }),
    );
  });

  it('leaves a text with no at sign, no bearer and no key prefix as it is, for any such text', () => {
    fc.assert(
      fc.property(
        fc.string().filter((t) => !/@|bearer|sk-|pk-/i.test(t)),
        (text) => {
          expect(redact(text)).toBe(text);
        },
      ),
    );
  });
});

describe('createMask, by pattern', () => {
  it('masks emails in a decoded value, keys and strings', () => {
    expect(createMask([])({ data: { 'a@b.io': ['c@d.io', 5] } })).toEqual({
      '[REDACTED]': ['[REDACTED]', 5],
    });
  });
});
