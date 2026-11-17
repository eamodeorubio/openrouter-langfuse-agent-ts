import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QUERY_NAMES, QueryError, runQuery } from '../src/oracle/queries.js';
import { catalogModel as model } from './oracleFixture.js';

/** The worked table of the oracle spec for the query `free`. */
const TABLE = [
  model('t/a', 262144, true, 1.0, 4.0),
  model('t/d', 300000, true, 0, 0),
  model('t/e', 300000, false, 0, 0),
  model('t/f', 300000, true, null, null),
  model('t/g', 200000, true, 0, 0),
  model('t/h', 128000, true, 0, 0),
];

const PARAMS = { minContext: 200000, supportedParameters: ['tools'] };

describe('the query free', () => {
  it('is one of the known queries', () => {
    expect(QUERY_NAMES).toContain('free');
  });

  it('returns every model that meets the constraints and costs nothing on either side', () => {
    expect(runQuery('free', TABLE, PARAMS)).toEqual(['t/d', 't/g']);
  });

  it('returns nothing when no free model has the context', () => {
    expect(
      runQuery('free', TABLE, { ...PARAMS, minContext: 1_000_000 }),
    ).toEqual([]);
  });

  it('leaves out a model with a null price, and one that charges on a single side', () => {
    const odd = [
      model('t/null', 300000, true, null, null),
      model('t/half-in', 300000, true, 0, 1),
      model('t/half-out', 300000, true, 1, 0),
      model('t/null-out', 300000, true, 0, null),
    ];
    expect(runQuery('free', odd, PARAMS)).toEqual([]);
  });

  it('honours the modalities', () => {
    const models = [
      model('t/text', 300000, true, 0, 0),
      model('t/image', 300000, true, 0, 0, { input: ['text', 'image'] }),
    ];
    expect(
      runQuery('free', models, { ...PARAMS, inputModalities: ['image'] }),
    ).toEqual(['t/image']);
  });

  it('refuses a parameter it does not know, so that a typo cannot drop a constraint', () => {
    expect(() => runQuery('free', TABLE, { minContxt: 1 })).toThrow(QueryError);
    expect(() => runQuery('free', TABLE, { minContxt: 1 })).toThrow(
      'Unknown parameter "minContxt" for the query free.',
    );
  });

  it('returns only models that are free, in ascending order, whatever the snapshot', () => {
    const price = fc.oneof(
      fc.constant(0),
      fc.constant(null),
      fc.double({ min: 0.001, max: 100, noNaN: true }),
    );
    const models = fc.uniqueArray(
      fc
        .tuple(fc.string({ minLength: 1, maxLength: 6 }), price, price)
        .map(([id, input, output]) =>
          model(`t/${id}`, 300000, true, input, output),
        ),
      { maxLength: 20, selector: (entry) => entry.id },
    );
    fc.assert(
      fc.property(models, (snapshot) => {
        const found = runQuery('free', snapshot, {});
        const sorted = [...found].sort();
        expect(found).toEqual(sorted);
        for (const slug of found) {
          const entry = snapshot.find((candidate) => candidate.id === slug);
          expect(entry?.inputPrice).toBe(0);
          expect(entry?.outputPrice).toBe(0);
        }
      }),
    );
  });
});
