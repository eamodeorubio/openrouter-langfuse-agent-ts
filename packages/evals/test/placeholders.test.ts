import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PickError } from '../src/oracle/picks.js';
import { resolvePlaceholders } from '../src/provider/placeholders.js';
import { catalogModel } from './oracleFixture.js';

const models = [
  catalogModel('a/x', 1000, true, 1, 3),
  catalogModel('b/y', 1000, true, 100, 110),
  catalogModel('m/free:free', 1000, true, 0, 0),
  catalogModel('z/free:free', 1000, true, 0, 0),
];
const snapshot = { fetchedAt: 'now', models };

describe('resolvePlaceholders', () => {
  it('replaces the flagship and the free model, everywhere they occur', () => {
    expect(
      resolvePlaceholders(
        'Can I afford {flagship_model}? Or {free_model}, or {flagship_model} again?',
        snapshot,
        ['m/free:free'],
      ),
    ).toBe('Can I afford b/y? Or z/free:free, or b/y again?');
  });

  it('leaves a prompt with no placeholder, and any other {name}, as it was', () => {
    for (const prompt of [
      'What does a/x cost?',
      'Keep {other} and {{x}} and {}',
    ]) {
      expect(resolvePlaceholders(prompt, snapshot, [])).toBe(prompt);
    }
  });

  it('needs no snapshot when the prompt holds no placeholder', () => {
    expect(resolvePlaceholders('plain', undefined, [])).toBe('plain');
  });

  it('fails with an error that names the snapshot when a placeholder has none', () => {
    expect(() =>
      resolvePlaceholders('Price of {free_model}?', undefined, []),
    ).toThrow(PickError);
    expect(() =>
      resolvePlaceholders('Price of {free_model}?', undefined, []),
    ).toThrow(
      'The prompt holds the placeholder {free_model}, and the run has no snapshot: EVAL_CATALOG names none.',
    );
  });

  it('asks for a pick only for the placeholders the prompt holds', () => {
    const noFree = {
      fetchedAt: 'now',
      models: [models[0], models[1]],
    } as never;
    expect(resolvePlaceholders('{flagship_model}', noFree, [])).toBe('b/y');
    expect(() => resolvePlaceholders('{free_model}', noFree, [])).toThrow(
      'no free model',
    );
  });

  it('fails with a PickError, and no other error, for a placeholder the snapshot cannot fill', () => {
    const none = { fetchedAt: 'now', models: [] };
    for (const prompt of ['{flagship_model}', 'x {free_model} y']) {
      expect(() => resolvePlaceholders(prompt, none, [])).toThrow(PickError);
    }
  });

  it('puts a slug in as written, whatever characters it holds', () => {
    const odd = {
      fetchedAt: 'now',
      models: [catalogModel("a/$&b'$`", 1000, true, 1, 1)],
    };
    expect(resolvePlaceholders('{flagship_model}!', odd, [])).toBe("a/$&b'$`!");
  });

  it('leaves any prompt with no placeholder untouched', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const prompt = text.replaceAll('_model}', '}');
        expect(resolvePlaceholders(prompt, snapshot, [])).toBe(prompt);
      }),
    );
  });
});
