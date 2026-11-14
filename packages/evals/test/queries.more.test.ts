import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QUERY_NAMES, QueryError, runQuery } from '../src/oracle/queries.js';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { catalogModel, TABLE } from './oracleFixture.js';

const IMAGE_IN = { input: ['text', 'image'] };

const MODELS: CatalogModel[] = [
  catalogModel('v/cheap', 8000, true, 0.05, 0.1, IMAGE_IN),
  catalogModel('v/mid', 500000, true, 0.5, 2, IMAGE_IN),
  catalogModel('v/text', 500000, true, 0.2, 1),
  catalogModel('v/free', 500000, true, 0, 0, IMAGE_IN),
  catalogModel('v/draw', 2_000_000, false, 0.3, 0.9, {
    output: ['text', 'image'],
  }),
  catalogModel('v/open', 300000, true, 0.4, null, IMAGE_IN),
  catalogModel('v/null', 300000, true, null, null, IMAGE_IN),
];

describe('the query cheapest-input', () => {
  const run = (params: Record<string, unknown>, models = MODELS) =>
    runQuery('cheapest-input', models, params);

  it('returns the paid model with the lowest input price that meets every constraint', () => {
    expect(run({ minContext: 200000, supportedParameters: ['tools'] })).toEqual(
      ['v/text'],
    );
    expect(
      runQuery('cheapest-input', TABLE, {
        minContext: 200000,
        supportedParameters: ['tools'],
      }),
    ).toEqual(['t/h']);
  });

  it('filters by the modalities a model accepts and produces, all of them required', () => {
    expect(run({ inputModalities: ['image'] })).toEqual(['v/cheap']);
    expect(
      run({ inputModalities: ['text', 'image'], minContext: 400000 }),
    ).toEqual(['v/mid']);
    expect(run({ inputModalities: ['audio'] })).toEqual([]);
    expect(run({ outputModalities: ['image'] })).toEqual(['v/draw']);
    expect(run({ outputModalities: ['image', 'text'] })).toEqual(['v/draw']);
    expect(run({ outputModalities: ['image', 'video'] })).toEqual([]);
  });

  it('never returns a free model or one with no input price, and asks nothing of the output price', () => {
    const only = [
      catalogModel('f/free', 1, true, 0, 0),
      catalogModel('n/null', 1, true, null, 1),
    ];
    expect(run({}, only)).toEqual([]);
    expect(run({}, [catalogModel('o/open', 1, true, 1, null)])).toEqual([
      'o/open',
    ]);
  });

  it('keeps a model at exactly one percent above the lowest input price and drops the next', () => {
    const edge = [
      catalogModel('e/x', 1, true, 1, 9),
      catalogModel('e/y', 1, true, 1.01, 9),
      catalogModel('e/z', 1, true, 1.011, 9),
    ];
    expect(run({}, edge)).toEqual(['e/x', 'e/y']);
  });

  it('is in ascending order of slug, whatever the order of the snapshot', () => {
    const ties = [
      catalogModel('z/z', 1, true, 1, 1),
      catalogModel('a/a', 1, true, 1, 1),
    ];
    expect(run({}, ties)).toEqual(['a/a', 'z/z']);
    expect(run({}, [...ties].reverse())).toEqual(['a/a', 'z/z']);
  });

  it.each([
    [
      { minContext: 'big' },
      'The query cheapest-input takes minContext as a number from 0, got "big".',
    ],
    [
      { supportedParameters: 'tools' },
      'The query cheapest-input takes supportedParameters as a list of text, got "tools".',
    ],
    [
      { inputModalities: [1] },
      'The query cheapest-input takes inputModalities as a list of text, got [1].',
    ],
    [
      { outputModalities: 'image' },
      'The query cheapest-input takes outputModalities as a list of text, got "image".',
    ],
    [
      { mix: 3 },
      'Unknown parameter "mix" for the query cheapest-input. The known ones are: minContext, supportedParameters, inputModalities, outputModalities.',
    ],
  ])('refuses the parameters %j', (params, message) => {
    expect(() => run(params)).toThrow(QueryError);
    expect(() => run(params)).toThrow(message);
  });
});

describe('the query matching', () => {
  const run = (params: Record<string, unknown>, models = MODELS) =>
    runQuery('matching', models, params);

  it('returns every model that meets every constraint, free ones and ones with no price too', () => {
    expect(runQuery('matching', TABLE, { minContext: 250000 })).toEqual([
      't/a',
      't/d',
      't/e',
      't/f',
      't/h',
    ]);
    expect(
      runQuery('matching', TABLE, {
        minContext: 250000,
        supportedParameters: ['tools'],
      }),
    ).toEqual(['t/a', 't/d', 't/f', 't/h']);
  });

  it('counts the models, as the number of slugs it returns', () => {
    expect(
      run({ minContext: 300000, supportedParameters: ['tools'] }),
    ).toHaveLength(5);
  });

  it('takes maxInputPrice as a strict bound, and leaves out a model with no input price', () => {
    expect(run({ maxInputPrice: 0.5 })).toEqual([
      'v/cheap',
      'v/draw',
      'v/free',
      'v/open',
      'v/text',
    ]);
    expect(run({ maxInputPrice: 0.05 })).toEqual(['v/free']);
    expect(run({ maxInputPrice: 0 })).toEqual([]);
  });

  it('returns none when no model has the context, the modality and the price', () => {
    expect(
      run({
        minContext: 2_000_000,
        outputModalities: ['image'],
        maxInputPrice: 0.01,
      }),
    ).toEqual([]);
    expect(run({ minContext: 2_000_000, outputModalities: ['image'] })).toEqual(
      ['v/draw'],
    );
  });

  it('filters by modalities and parameters, all required', () => {
    expect(
      run({
        inputModalities: ['image'],
        supportedParameters: ['tools', 'seed'],
        minContext: 400000,
      }),
    ).toEqual(['v/free', 'v/mid']);
  });

  it('returns nothing for an empty snapshot and everything for no constraint', () => {
    expect(run({}, [])).toEqual([]);
    expect(run({})).toHaveLength(MODELS.length);
    expect(run({})).toEqual([...run({})].sort());
  });

  it.each([
    [
      { maxInputPrice: 'cheap' },
      'The query matching takes maxInputPrice as a number from 0, got "cheap".',
    ],
    [
      { maxInputPrice: -1 },
      'The query matching takes maxInputPrice as a number from 0, got -1.',
    ],
    [
      { minContext: -1 },
      'The query matching takes minContext as a number from 0, got -1.',
    ],
    [
      { mix: 3 },
      'Unknown parameter "mix" for the query matching. The known ones are: minContext, supportedParameters, inputModalities, outputModalities, maxInputPrice.',
    ],
  ])('refuses the parameters %j', (params, message) => {
    expect(() => run(params)).toThrow(QueryError);
    expect(() => run(params)).toThrow(message);
  });
});

describe('the queries, for any snapshot', () => {
  const WORDS = ['text', 'image', 'audio'] as const;
  const PARAMETERS = ['tools', 'seed'] as const;
  const price = fc.option(fc.double({ min: 0, max: 50, noNaN: true }), {
    nil: null,
  });
  const snapshot = fc
    .uniqueArray(fc.stringMatching(/^[a-z]{1,3}\/[a-z0-9]{1,4}$/), {
      maxLength: 10,
    })
    .chain((ids) =>
      fc.tuple(
        ...ids.map((id) =>
          fc.record({
            id: fc.constant(id),
            contextLength: fc.option(fc.integer({ min: 0, max: 2_000_000 }), {
              nil: null,
            }),
            supportedParameters: fc.subarray([...PARAMETERS]),
            inputModalities: fc.subarray([...WORDS]),
            outputModalities: fc.subarray([...WORDS]),
            inputPrice: price,
            outputPrice: price,
          }),
        ),
      ),
    ) as fc.Arbitrary<CatalogModel[]>;
  const constraints = fc.record({
    minContext: fc.integer({ min: 0, max: 2_000_000 }),
    supportedParameters: fc.subarray([...PARAMETERS]),
    inputModalities: fc.subarray([...WORDS]),
    outputModalities: fc.subarray([...WORDS]),
  });

  const meets = (
    m: CatalogModel,
    c: {
      minContext: number;
      supportedParameters: string[];
      inputModalities: string[];
      outputModalities: string[];
    },
  ) =>
    (m.contextLength ?? 0) >= c.minContext &&
    c.supportedParameters.every((p) => m.supportedParameters.includes(p)) &&
    c.inputModalities.every((p) => m.inputModalities.includes(p)) &&
    c.outputModalities.every((p) => m.outputModalities.includes(p));

  it('matching returns exactly the models that meet the constraints, sorted', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, c) => {
        const expected = models
          .filter((m) => meets(m, c))
          .map((m) => m.id)
          .sort();
        expect(runQuery('matching', models, c)).toEqual(expected);
      }),
    );
  });

  it('cheapest-input returns paid models that meet the constraints, and the cheapest of them', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, c) => {
        const result = runQuery('cheapest-input', models, c);
        const eligible = models.filter(
          (m) => meets(m, c) && (m.inputPrice ?? 0) > 0,
        );
        expect(result.length > 0).toBe(eligible.length > 0);
        for (const id of result) {
          const found = models.find((m) => m.id === id) as CatalogModel;
          expect(meets(found, c)).toBe(true);
          expect(found.inputPrice ?? 0).toBeGreaterThan(0);
        }
        if (eligible.length > 0) {
          const lowest = Math.min(
            ...eligible.map((m) => m.inputPrice as number),
          );
          const best = eligible.find(
            (m) => m.inputPrice === lowest,
          ) as CatalogModel;
          expect(result).toContain(best.id);
        }
      }),
    );
  });

  it('do not depend on the order of the snapshot', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, c) => {
        for (const name of ['matching', 'cheapest-input']) {
          expect(runQuery(name, [...models].reverse(), c)).toEqual(
            runQuery(name, models, c),
          );
        }
      }),
    );
  });

  it('are listed by name', () => {
    expect(QUERY_NAMES).toEqual([
      'cheapest-blended',
      'cheapest-input',
      'matching',
      'within-budget',
    ]);
  });
});
