import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blendedPrice,
  QUERY_NAMES,
  QueryError,
  runQuery,
} from '../src/oracle/queries.js';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { catalogModel, TABLE } from './oracleFixture.js';

const model = catalogModel;

const PARAMS = { minContext: 200000, supportedParameters: ['tools'], mix: 3 };

describe('the blended price', () => {
  it('weighs the input price by the mix and the output price by one', () => {
    expect(blendedPrice(model('x/y', 1, true, 1, 4), 3)).toBe(1.75);
    expect(blendedPrice(model('x/y', 1, true, 2, 0.4), 3)).toBeCloseTo(1.6, 12);
    expect(blendedPrice(model('x/y', 1, true, 1, 3), 1)).toBe(2);
  });

  it('is null when a price is missing', () => {
    expect(blendedPrice(model('x/y', 1, true, null, 1), 3)).toBeNull();
    expect(blendedPrice(model('x/y', 1, true, 1, null), 3)).toBeNull();
  });
});

describe('the query cheapest-blended', () => {
  it('returns the paid models with the lowest blended price, ties included', () => {
    expect(runQuery('cheapest-blended', TABLE, PARAMS)).toEqual(['t/g', 't/h']);
  });

  it('returns nothing when no model has the context', () => {
    expect(
      runQuery('cheapest-blended', TABLE, { ...PARAMS, minContext: 1_000_000 }),
    ).toEqual([]);
  });

  it('takes a mix of 3 input tokens per output token when none is given', () => {
    const { mix, ...withoutMix } = PARAMS;
    expect(runQuery('cheapest-blended', TABLE, withoutMix)).toEqual([
      't/g',
      't/h',
    ]);
  });

  it('changes its answer with the mix', () => {
    expect(runQuery('cheapest-blended', TABLE, { ...PARAMS, mix: 1 })).toEqual([
      't/b',
    ]);
  });

  it('requires every parameter asked for', () => {
    expect(
      runQuery('cheapest-blended', TABLE, {
        ...PARAMS,
        supportedParameters: ['tools', 'reasoning'],
      }),
    ).toEqual([]);
    expect(
      runQuery('cheapest-blended', TABLE, {
        minContext: 0,
        supportedParameters: ['tools', 'seed'],
      }),
    ).not.toContain('t/e');
  });

  it('asks for no parameter and no context when none is given', () => {
    expect(runQuery('cheapest-blended', TABLE, {})).toEqual(['t/e']);
  });

  it('leaves out free models, models with a null price, and models that lack a requirement', () => {
    const all = runQuery('cheapest-blended', TABLE, { minContext: 0, mix: 1 });
    expect(all).not.toContain('t/d');
    expect(all).not.toContain('t/f');
    expect(
      runQuery('cheapest-blended', TABLE, { ...PARAMS, minContext: 0 }),
    ).toEqual(['t/c']);
  });

  it('counts a model whose input is free and whose output is paid as paid', () => {
    const half = [model('h/i', 10, true, 0, 2), model('h/j', 10, true, 1, 1)];
    expect(runQuery('cheapest-blended', half, { mix: 1 })).toEqual([
      'h/i',
      'h/j',
    ]);
  });

  it('keeps a model at exactly one percent above the cheapest and drops the next', () => {
    const edge = [
      model('e/x', 1, true, 1, 1),
      model('e/y', 1, true, 1.01, 1.01),
      model('e/z', 1, true, 1.011, 1.011),
    ];
    expect(runQuery('cheapest-blended', edge, { mix: 1 })).toEqual([
      'e/x',
      'e/y',
    ]);
  });

  it('treats a model with no context as having none', () => {
    const unknown = [model('u/v', null, true, 1, 1)];
    expect(runQuery('cheapest-blended', unknown, { minContext: 1 })).toEqual(
      [],
    );
    expect(runQuery('cheapest-blended', unknown, { minContext: 0 })).toEqual([
      'u/v',
    ]);
  });

  it.each([
    [{ minContext: 'big' }, /minContext/],
    [{ minContext: -1 }, /minContext/],
    [{ supportedParameters: 'tools' }, /supportedParameters/],
    [{ supportedParameters: [1] }, /supportedParameters/],
    [{ mix: 0 }, /mix/],
    [{ mix: -2 }, /mix/],
    [{ mix: 'three' }, /mix/],
  ])(
    'refuses the parameters %j with a message that names the parameter',
    (params, name) => {
      expect(() => runQuery('cheapest-blended', TABLE, params)).toThrow(
        QueryError,
      );
      expect(() => runQuery('cheapest-blended', TABLE, params)).toThrow(name);
    },
  );
});

describe('a tighter constraint', () => {
  it('can let a dearer model in, when it removes the cheapest one', () => {
    const two = [model('c/a', 100, true, 1, 1), model('c/b', 200, true, 2, 2)];
    expect(runQuery('cheapest-blended', two, { minContext: 100 })).toEqual([
      'c/a',
    ]);
    expect(runQuery('cheapest-blended', two, { minContext: 150 })).toEqual([
      'c/b',
    ]);
  });

  it('leaves out every model below the context it asks for', () => {
    const result = runQuery('cheapest-blended', TABLE, {
      ...PARAMS,
      minContext: 250000,
    });
    expect(result).toEqual(['t/h']);
  });
});

describe('the names of the queries', () => {
  it('list the known queries when a name is not one of them', () => {
    expect(QUERY_NAMES).toEqual([
      'cheapest-blended',
      'cheapest-input',
      'free',
      'matching',
      'within-budget',
    ]);
    expect(() => runQuery('cheapest-bogus', TABLE, {})).toThrow(QueryError);
    expect(() => runQuery('cheapest-bogus', TABLE, {})).toThrow(
      'Unknown oracle query "cheapest-bogus". The known queries are: cheapest-blended, cheapest-input, free, matching, within-budget.',
    );
  });

  it('are not the names of an object', () => {
    expect(() => runQuery('toString', TABLE, {})).toThrow(
      /Unknown oracle query/,
    );
    expect(() => runQuery('__proto__', TABLE, {})).toThrow(
      /Unknown oracle query/,
    );
  });
});

describe('the queries, for any snapshot', () => {
  const PARAMETERS = ['tools', 'reasoning', 'seed'] as const;
  const price = fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
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
            inputPrice: price,
            outputPrice: price,
          }),
        ),
      ),
    ) as fc.Arbitrary<CatalogModel[]>;
  const constraints = fc.record({
    minContext: fc.integer({ min: 0, max: 2_000_000 }),
    supportedParameters: fc.subarray([...PARAMETERS]),
    mix: fc.double({ min: 0.1, max: 10, noNaN: true }),
  });

  it('return a subset of the snapshot', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, params) => {
        const ids = new Set(models.map((m) => m.id));
        for (const id of runQuery('cheapest-blended', models, params)) {
          expect(ids.has(id)).toBe(true);
        }
      }),
    );
  });

  it('do not depend on the order of the snapshot', () => {
    fc.assert(
      fc.property(snapshot, constraints, fc.nat(), (models, params, turn) => {
        const rotated = [
          ...models.slice(turn % (models.length || 1)),
          ...models.slice(0, turn % (models.length || 1)),
        ];
        expect(runQuery('cheapest-blended', rotated, params)).toEqual(
          runQuery('cheapest-blended', models, params),
        );
        expect(
          runQuery('cheapest-blended', [...models].reverse(), params),
        ).toEqual(runQuery('cheapest-blended', models, params));
      }),
    );
  });

  it('return only models that meet every constraint, and are paid', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, params) => {
        for (const id of runQuery('cheapest-blended', models, params)) {
          const found = models.find((m) => m.id === id) as CatalogModel;
          expect(found.contextLength ?? 0).toBeGreaterThanOrEqual(
            params.minContext,
          );
          for (const name of params.supportedParameters) {
            expect(found.supportedParameters).toContain(name);
          }
          expect(blendedPrice(found, params.mix)).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('return the cheapest eligible model whenever any is eligible', () => {
    fc.assert(
      fc.property(snapshot, constraints, (models, params) => {
        const eligible = models.filter(
          (m) =>
            (m.contextLength ?? 0) >= params.minContext &&
            params.supportedParameters.every((n) =>
              m.supportedParameters.includes(n),
            ) &&
            (blendedPrice(m, params.mix) ?? 0) > 0,
        );
        const result = runQuery('cheapest-blended', models, params);
        expect(result.length > 0).toBe(eligible.length > 0);
        if (eligible.length > 0) {
          const cheapest = Math.min(
            ...eligible.map((m) => blendedPrice(m, params.mix) as number),
          );
          const best = eligible.find(
            (m) => blendedPrice(m, params.mix) === cheapest,
          ) as CatalogModel;
          expect(result).toContain(best.id);
        }
      }),
    );
  });

  it('give nothing for an empty snapshot', () => {
    fc.assert(
      fc.property(constraints, (params) => {
        expect(runQuery('cheapest-blended', [], params)).toEqual([]);
      }),
    );
  });
});

describe('the messages of a refused parameter', () => {
  it.each([
    [
      { minContext: 'big' },
      'The query cheapest-blended takes minContext as a number from 0, got "big".',
    ],
    [
      { minContext: -1 },
      'The query cheapest-blended takes minContext as a number from 0, got -1.',
    ],
    [
      { mix: 0 },
      'The query cheapest-blended takes mix as a number above 0, got 0.',
    ],
    [
      { supportedParameters: 'tools' },
      'The query cheapest-blended takes supportedParameters as a list of text, got "tools".',
    ],
  ])('for %j', (params, message) => {
    expect(() => runQuery('cheapest-blended', TABLE, params)).toThrow(message);
  });
});

describe('the order of a result', () => {
  it('is ascending by slug, whatever the order of the snapshot', () => {
    expect(runQuery('cheapest-blended', [...TABLE].reverse(), PARAMS)).toEqual([
      't/g',
      't/h',
    ]);
    const ties = [
      model('z/z', 1, true, 1, 1),
      model('a/a', 1, true, 1, 1),
      model('m/m', 1, true, 1, 1),
    ];
    expect(runQuery('cheapest-blended', ties, { mix: 1 })).toEqual([
      'a/a',
      'm/m',
      'z/z',
    ]);
  });
});
