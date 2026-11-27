import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readGateConfig } from '../src/gate/config.js';

const base = {
  model: 'm/one',
  repeat: 10,
  k: 3,
  mean: 0.85,
  cases: { 'a/one': 0.4, 'a/two': 0.05 },
};
const textOf = (value: unknown) => JSON.stringify(value);
const refused = (value: unknown) => {
  const read = readGateConfig(textOf(value));
  if (read.ok) throw new Error('expected a refusal');
  return read.message;
};

describe('readGateConfig', () => {
  it('reads a valid file', () => {
    expect(readGateConfig(textOf(base))).toEqual({ ok: true, config: base });
  });

  it('reads YAML text, not only JSON', () => {
    const read = readGateConfig(
      'model: m/one\nrepeat: 10\nk: 3\nmean: 0.85\ncases:\n  a/one: 0.4\n',
    );
    expect(read).toEqual({
      ok: true,
      config: { ...base, cases: { 'a/one': 0.4 } },
    });
  });

  it.each(['model', 'repeat', 'k', 'mean', 'cases'])(
    'refuses a file with no %s, naming the key',
    (key) => {
      const rest: Record<string, unknown> = { ...base };
      delete rest[key];
      expect(refused(rest)).toContain(key);
    },
  );

  it.each([
    ['model', 3],
    ['model', ''],
    ['repeat', '10'],
    ['repeat', 2.5],
    ['repeat', 0],
    ['k', 'three'],
    ['k', 0],
    ['k', 11],
    ['k', 1.5],
    ['mean', 1.1],
    ['mean', -0.1],
    ['mean', '0.5'],
    ['cases', []],
    ['cases', {}],
    ['cases', 'a/one'],
  ])('refuses %s of %j, naming the key', (key, value) => {
    expect(refused({ ...base, [key]: value })).toContain(key);
  });

  it.each([-0.1, 1.1, '0.4', null])(
    'refuses the floor %j of a case, naming the case',
    (floor) => {
      expect(
        refused({ ...base, cases: { 'a/one': 0.4, 'a/bad': floor } }),
      ).toContain('a/bad');
    },
  );

  it('refuses an unknown key, naming it', () => {
    expect(refused({ ...base, floor: 0.4 })).toContain('floor');
  });

  it('refuses text that is not a mapping', () => {
    for (const text of ['', '- a', '3', 'null']) {
      expect(readGateConfig(text).ok, text).toBe(false);
    }
  });

  it('refuses text that is not YAML, and says so', () => {
    const read = readGateConfig('a: [');
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.message).toContain('not valid YAML');
  });

  it('says a file that is not a mapping must be one', () => {
    const read = readGateConfig('- a');
    expect(read.ok ? '' : read.message).toContain('mapping');
  });

  it('names an unknown key in a sentence that says it is unknown', () => {
    expect(refused({ ...base, floors: 1, extra: 2 })).toBe(
      'unknown key floors, extra.',
    );
  });

  it('accepts repeat 1 with k 1', () => {
    expect(readGateConfig(textOf({ ...base, repeat: 1, k: 1 })).ok).toBe(true);
  });

  it('accepts the bounds 0 and 1, and k equal to repeat', () => {
    expect(
      readGateConfig(
        textOf({ ...base, repeat: 3, k: 3, mean: 0, cases: { a: 1, b: 0 } }),
      ).ok,
    ).toBe(true);
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => readGateConfig(text)).not.toThrow();
      }),
    );
  });

  it('refuses any number outside [0, 1] for mean or a case floor', () => {
    const outside = fc.oneof(
      fc.double({ min: 1.0000001, max: 1e9, noNaN: true }),
      fc.double({ min: -1e9, max: -1e-9, noNaN: true }),
    );
    fc.assert(
      fc.property(outside, (value) => {
        expect(readGateConfig(textOf({ ...base, mean: value })).ok).toBe(false);
        expect(
          readGateConfig(textOf({ ...base, cases: { 'a/one': value } })).ok,
        ).toBe(false);
      }),
    );
  });
});
