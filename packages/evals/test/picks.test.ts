import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flagshipModel, freeModel, PickError } from '../src/oracle/picks.js';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { catalogModel } from './oracleFixture.js';

describe('flagshipModel', () => {
  it('is the paid model with the highest sum of prices, and the lowest slug on a tie', () => {
    expect(
      flagshipModel([
        catalogModel('a/x', 1000, true, 1, 3),
        catalogModel('c/z', 1000, true, 10, 200),
        catalogModel('b/y', 1000, true, 100, 110),
      ]),
    ).toBe('b/y');
  });

  it('leaves out a model with no price, with one price missing, and a free one', () => {
    expect(
      flagshipModel([
        catalogModel('a/none', 1000, true, null, null),
        catalogModel('a/half', 1000, true, 5000, null),
        catalogModel('a/free', 1000, true, 0, 0),
        catalogModel('a/paid', 1000, true, 1, 2),
      ]),
    ).toBe('a/paid');
  });

  it('fails with a clear error when the snapshot holds no paid model', () => {
    expect(() => flagshipModel([])).toThrow(PickError);
    expect(() =>
      flagshipModel([catalogModel('a/free', 1000, true, 0, 0)]),
    ).toThrow('The snapshot holds no paid model to be the flagship.');
  });

  it('compares slugs by code unit, not by locale', () => {
    expect(
      flagshipModel([
        catalogModel('b/y', 1000, true, 1, 1),
        catalogModel('B/y', 1000, true, 1, 1),
      ]),
    ).toBe('B/y');
  });

  const priced = fc.uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      input: fc.option(fc.nat({ max: 1000 }), { nil: null }),
      output: fc.option(fc.nat({ max: 1000 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 12, selector: (row) => row.id },
  );
  const build = (
    rows: { id: string; input: number | null; output: number | null }[],
  ): CatalogModel[] =>
    rows.map((row) => catalogModel(row.id, 1000, true, row.input, row.output));

  it('names a model of the snapshot that no paid model outprices, whatever the order', () => {
    fc.assert(
      fc.property(priced, (rows) => {
        const models = build(rows);
        const paid = models.filter(
          (m) =>
            m.inputPrice !== null &&
            m.outputPrice !== null &&
            m.inputPrice + m.outputPrice > 0,
        );
        if (paid.length === 0) {
          expect(() => flagshipModel(models)).toThrow(PickError);
          return;
        }
        const pick = flagshipModel(models);
        const chosen = paid.find((m) => m.id === pick);
        expect(chosen).toBeDefined();
        const sum = (chosen?.inputPrice ?? 0) + (chosen?.outputPrice ?? 0);
        for (const m of paid) {
          expect(
            (m.inputPrice ?? 0) + (m.outputPrice ?? 0),
          ).toBeLessThanOrEqual(sum);
        }
        expect(flagshipModel([...models].reverse())).toBe(pick);
      }),
    );
  });
});

describe('freeModel', () => {
  const free = (id: string) => catalogModel(id, 1000, true, 0, 0);

  it('is the first free slug, in ascending order, that is not a model under test', () => {
    expect(
      freeModel(
        [
          free('z/y:free'),
          free('a/b:free'),
          free('nvidia/nemotron-3-ultra-550b-a55b:free'),
        ],
        ['nvidia/nemotron-3-ultra-550b-a55b:free'],
      ),
    ).toBe('a/b:free');
    expect(
      freeModel(
        [free('a/b:free'), free('c/d:free')],
        ['a/b:free', 'anthropic/claude-haiku-5.5'],
      ),
    ).toBe('c/d:free');
  });

  it('compares the models under test without regard to case', () => {
    expect(freeModel([free('a/b:free'), free('c/d:free')], ['A/B:FREE'])).toBe(
      'c/d:free',
    );
  });

  it('counts a model as free only when both prices are 0', () => {
    expect(
      freeModel(
        [
          catalogModel('a/none', 1000, true, null, null),
          catalogModel('a/in', 1000, true, 0, 1),
          catalogModel('a/out', 1000, true, 1, 0),
          catalogModel('b/free', 1000, true, 0, 0),
        ],
        [],
      ),
    ).toBe('b/free');
  });

  it('fails with an error that says no free model is available, when only the models under test are free', () => {
    const models = [free('a/b:free'), catalogModel('c/d', 1000, true, 1, 1)];
    expect(() => freeModel(models, ['a/b:free'])).toThrow(PickError);
    expect(() => freeModel(models, ['a/b:free'])).toThrow(
      'The snapshot holds no free model besides the models under test (a/b:free).',
    );
    expect(() => freeModel([], [])).toThrow(
      'The snapshot holds no free model besides the models under test ().',
    );
  });

  it('names a free model that is not under test, whatever the order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 8 }),
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
        (ids, under) => {
          const models = ids.map(free);
          const eligible = ids.filter(
            (id) => !under.some((u) => u.toLowerCase() === id.toLowerCase()),
          );
          if (eligible.length === 0) {
            expect(() => freeModel(models, under)).toThrow(PickError);
            return;
          }
          const pick = freeModel(models, under);
          expect(eligible).toContain(pick);
          expect(eligible.every((id) => pick <= id)).toBe(true);
          expect(freeModel([...models].reverse(), under)).toBe(pick);
        },
      ),
    );
  });
});
