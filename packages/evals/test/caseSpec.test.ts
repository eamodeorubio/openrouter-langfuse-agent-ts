import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CaseError,
  KNOWN_DECLARATIONS,
  readCase,
} from '../src/checks/caseSpec.js';

const declare = (metadata: unknown) => ({ test: { metadata } });

describe('what a case declares', () => {
  it('is nothing when the test case has no metadata, or no test', () => {
    expect(readCase(undefined)).toEqual({});
    expect(readCase(null)).toEqual({});
    expect(readCase({})).toEqual({});
    expect(readCase({ test: {} })).toEqual({});
    expect(readCase(declare(undefined))).toEqual({});
    expect(readCase('text')).toEqual({});
  });

  it('is read, typed, from the metadata', () => {
    const oracle = {
      query: 'cheapest-blended',
      params: { minContext: 1 },
      search: { min_context_length: 1, supported_parameters: ['tools'] },
    };
    expect(
      readCase(
        declare({
          id: 'lookup/known-model',
          set: 'core',
          needsLookup: true,
          needsArithmetic: false,
          expectedCost: 3,
          askedModel: 'a/b',
          askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
          oracle,
        }),
      ),
    ).toEqual({
      id: 'lookup/known-model',
      set: 'core',
      needsLookup: true,
      needsArithmetic: false,
      expectedCost: 3,
      askedModel: 'a/b',
      askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
      oracle,
    });
  });

  it('accepts both sets', () => {
    expect(readCase(declare({ set: 'core' }))).toEqual({ set: 'core' });
    expect(readCase(declare({ set: 'full' }))).toEqual({ set: 'full' });
  });

  it('keeps nothing it was not given', () => {
    expect(Object.keys(readCase(declare({ needsLookup: true })))).toEqual([
      'needsLookup',
    ]);
  });

  it('lists the declarations a case may make', () => {
    expect([...KNOWN_DECLARATIONS].sort()).toEqual([
      'askedFigures',
      'askedModel',
      'expectedCost',
      'id',
      'needsArithmetic',
      'needsLookup',
      'oracle',
      'set',
    ]);
  });
});

describe('a declaration that is not known', () => {
  it('fails loudly, with the name and the known ones, so that a typo cannot turn a check into a pass', () => {
    expect(() => readCase(declare({ needsLookp: true }))).toThrow(CaseError);
    expect(() => readCase(declare({ needsLookp: true }))).toThrow(
      'Unknown declaration "needsLookp" in the metadata of a case. The known ones are: id, set, needsLookup, needsArithmetic, expectedCost, askedModel, askedFigures, oracle.',
    );
  });

  it('is found among known ones', () => {
    expect(() => readCase(declare({ id: 'A1', extra: 1 }))).toThrow(/"extra"/);
  });
});

describe('a declaration of the wrong kind', () => {
  it.each([
    ['id', '', 'text'],
    ['id', 3, 'text'],
    ['set', 'all', "'core' or 'full'"],
    ['set', 3, "'core' or 'full'"],
    ['needsLookup', 'yes', 'true or false'],
    ['needsLookup', 1, 'true or false'],
    ['needsArithmetic', null, 'true or false'],
    ['expectedCost', '3', 'a finite number'],
    ['expectedCost', Number.NaN, 'a finite number'],
    ['expectedCost', Number.POSITIVE_INFINITY, 'a finite number'],
    ['askedModel', 7, 'text'],
    ['askedModel', '', 'text'],
    [
      'askedFigures',
      'inputPrice',
      'a list of figure names (inputPrice, outputPrice, contextLength)',
    ],
    [
      'askedFigures',
      ['inputPrice', 'colour'],
      'a list of figure names (inputPrice, outputPrice, contextLength)',
    ],
    [
      'askedFigures',
      [1],
      'a list of figure names (inputPrice, outputPrice, contextLength)',
    ],
  ])('is refused: %s as %j', (name, value, rule) => {
    const metadata = { [name]: value };
    expect(() => readCase(declare(metadata))).toThrow(CaseError);
    expect(() => readCase(declare(metadata))).toThrow(
      `The declaration ${name} of a case must be ${rule}, got ${JSON.stringify(value)}.`,
    );
  });

  it('is refused when the metadata is not an object', () => {
    for (const metadata of ['text', 5, [], true]) {
      expect(() => readCase(declare(metadata))).toThrow(
        'The metadata of a case must be an object.',
      );
    }
  });

  it('accepts an empty list of figures and a cost of zero', () => {
    expect(readCase(declare({ askedFigures: [], expectedCost: 0 }))).toEqual({
      askedFigures: [],
      expectedCost: 0,
    });
  });
});

describe('the oracle of a case', () => {
  const oracle = (value: unknown) => declare({ oracle: value });

  it('needs a query name', () => {
    for (const value of [
      'text',
      5,
      null,
      {},
      { query: 5 },
      { params: {} },
      [],
    ]) {
      expect(() => readCase(oracle(value))).toThrow(
        'The oracle declaration of a case needs a query name.',
      );
    }
  });

  it('takes its params and its search as objects, and fills in none', () => {
    expect(readCase(oracle({ query: 'q' })).oracle).toEqual({
      query: 'q',
      params: {},
      search: {},
    });
    for (const bad of ['x', 5, null, []]) {
      expect(() => readCase(oracle({ query: 'q', params: bad }))).toThrow(
        'The oracle declaration of a case takes params as an object.',
      );
      expect(() => readCase(oracle({ query: 'q', search: bad }))).toThrow(
        'The oracle declaration of a case takes search as an object.',
      );
    }
  });

  it.each([
    ['text', '200000'],
    ['null', null],
    ['an object', {}],
    ['a list with a number', ['tools', 1]],
    ['a list with a null', [null]],
  ])('refuses a search requirement that is %s', (_, value) => {
    expect(() =>
      readCase(oracle({ query: 'q', search: { min_context_length: value } })),
    ).toThrow(
      'The oracle search requirement min_context_length must be a number or a list of text.',
    );
  });

  it('accepts a number, a list of text and an empty list as requirements', () => {
    const search = { a: 1, b: ['x', 'y'], c: [] };
    expect(readCase(oracle({ query: 'q', search })).oracle?.search).toEqual(
      search,
    );
  });
});

describe('reading a case, for any context', () => {
  it('returns a case or fails with a CaseError, and nothing else', () => {
    fc.assert(
      fc.property(fc.anything(), (context) => {
        try {
          expect(typeof readCase(context)).toBe('object');
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
        }
      }),
    );
  });
});
