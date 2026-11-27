import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QueryError, runQuery } from '../src/oracle/queries.js';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { catalogModel } from './oracleFixture.js';

const scored = (id: string, scores?: Record<string, number>): CatalogModel => ({
  ...catalogModel(id, 1, true, 1, 1),
  ...(scores && { scores }),
});

const MODELS = [
  scored('t/c', { legal_index: 40, cyber_index: 90 }),
  scored('t/b', { legal_index: 59.5 }),
  scored('t/a', { legal_index: 60 }),
  scored('t/d'),
];

const run = (params: Record<string, unknown>, models = MODELS) =>
  runQuery('top-index', models, params);

describe('the query top-index', () => {
  it('returns the models within one percent of the highest score, in the order of their slugs', () => {
    expect(run({ index: 'legal_index' })).toEqual(['t/a', 't/b']);
  });

  it('ranks by the index it is given alone', () => {
    expect(run({ index: 'cyber_index' })).toEqual(['t/c']);
  });

  it('keeps a model at exactly one percent below the highest score and drops the next', () => {
    const edge = [
      scored('e/top', { legal_index: 100 }),
      scored('e/edge', { legal_index: 99 }),
      scored('e/out', { legal_index: 98.99 }),
    ];
    expect(run({ index: 'legal_index' }, edge)).toEqual(['e/edge', 'e/top']);
  });

  it('ranks a score of 0', () => {
    expect(
      run({ index: 'legal_index' }, [scored('z/z', { legal_index: 0 })]),
    ).toEqual(['z/z']);
  });

  it.each([
    ['no model has the score', MODELS],
    ['the snapshot is empty', []],
  ])('returns nothing when %s', (_, models) => {
    expect(run({ index: 'finance_index' }, models)).toEqual([]);
  });

  it('does not read a name of every object as a score', () => {
    // One model has a score of that name, the other only what every object inherits.
    const models = [scored('t/x', { toString: 5 } as never), scored('t/d', {})];
    expect(run({ index: 'toString' }, models)).toEqual(['t/x']);
  });

  it('keeps the highest of scores below zero, and those within one percent of it', () => {
    const below = [
      scored('n/top', { legal_index: -100 }),
      scored('n/edge', { legal_index: -101 }),
      scored('n/out', { legal_index: -101.01 }),
    ];
    expect(run({ index: 'legal_index' }, below)).toEqual(['n/edge', 'n/top']);
  });

  it.each([
    [{}, 'undefined'],
    [{ index: 3 }, '3'],
    [{ index: '' }, '""'],
  ])('refuses %j and says what to send', (params, got) => {
    expect(() => run(params)).toThrow(QueryError);
    expect(() => run(params)).toThrow(
      `The query top-index takes index as the name of a score, such as legal_index, got ${got}.`,
    );
  });

  it('refuses a parameter it does not know', () => {
    expect(() => run({ index: 'legal_index', minContext: 1 })).toThrow(
      'Unknown parameter "minContext" for the query top-index. The known ones are: index.',
    );
  });

  it('returns exactly the models that no other beats by more than one percent, whatever the order of the snapshot', () => {
    const snapshot = fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z]{1,3}\/[a-z0-9]{1,4}$/),
        // The constants crowd the tie band and repeat, which free doubles seldom do.
        score: fc.option(
          fc.oneof(
            fc.constantFrom(-100, -99, 0, 98.99, 99, 99.5, 100),
            fc.double({ min: -100, max: 100, noNaN: true }),
          ),
          { nil: undefined },
        ),
      }),
      { selector: (entry) => entry.id, maxLength: 8 },
    );
    fc.assert(
      fc.property(snapshot, (entries) => {
        const models = entries.map(({ id, score }) =>
          scored(id, score === undefined ? undefined : { legal_index: score }),
        );
        const best = Math.max(...entries.flatMap((e) => e.score ?? []));
        const expected = entries
          .filter(
            (e) =>
              e.score !== undefined && e.score >= best - Math.abs(best) * 0.01,
          )
          .map((e) => e.id)
          .sort();
        expect(run({ index: 'legal_index' }, models)).toEqual(expected);
        expect(run({ index: 'legal_index' }, [...models].reverse())).toEqual(
          expected,
        );
      }),
    );
  });
});
