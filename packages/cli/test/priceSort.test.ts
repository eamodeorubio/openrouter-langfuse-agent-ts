import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blendedPrice,
  isPaid,
  PRICE_SORTS,
  type Priced,
  type PriceSort,
  rankByPrice,
} from '../src/tools/priceSort.js';

const item = (
  id: string,
  input: number | null,
  output: number | null,
): Priced => ({ id, input, output });

const price = fc.oneof(
  { weight: 4, arbitrary: fc.double({ min: 0, max: 1000, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.constant(null) },
);
const entries = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 30 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc
          .tuple(price, price)
          .map(([input, output]) => item(id, input, output)),
      ),
    ),
  );
const sorts = fc.constantFrom(...PRICE_SORTS);
const mixes = fc.double({ min: 0.001, max: 100, noNaN: true });

const keyOf = (entry: Priced, sort: PriceSort, mix: number): number | null =>
  sort.startsWith('input')
    ? entry.input
    : sort.startsWith('output')
      ? entry.output
      : blendedPrice(entry, mix);

describe('rankByPrice', () => {
  it('puts the lowest input price first, whatever the output price', () => {
    const ranked = rankByPrice(
      [
        item('a/x', 0.015, 0.045),
        item('b/y', 0.007, 6.8),
        item('c/z', 0.021, 0.063),
      ],
      'input-price-low-to-high',
      3,
    );
    expect(ranked.map((entry) => entry.id)).toEqual(['b/y', 'a/x', 'c/z']);
  });

  it('weights input and output by the mix in a blended order', () => {
    const ranked = rankByPrice(
      [item('a/x', 1, 5), item('b/y', 2, 1)],
      'blended-price-low-to-high',
      3,
    );
    expect(ranked.map((entry) => entry.id)).toEqual(['b/y', 'a/x']);
    expect(blendedPrice(item('a/x', 1, 5), 3)).toBe(2);
    expect(blendedPrice(item('b/y', 2, 1), 3)).toBe(1.75);
  });

  it('keeps a model with no price last in both directions, and equal prices in id order', () => {
    const models = [item('c/z', 1, null), item('b/y', 1, 3), item('a/x', 1, 3)];
    for (const sort of [
      'output-price-high-to-low',
      'output-price-low-to-high',
    ] as const) {
      expect(rankByPrice(models, sort, 3).map((entry) => entry.id)).toEqual([
        'a/x',
        'b/y',
        'c/z',
      ]);
    }
  });

  it('puts a free model first in a low-to-high order and last, before the unpriced, in a high-to-low one', () => {
    const models = [item('a/x', 0, 0), item('b/y', 2, 1), item('c/z', null, 1)];
    expect(
      rankByPrice(models, 'input-price-low-to-high', 3).map((e) => e.id),
    ).toEqual(['a/x', 'b/y', 'c/z']);
    expect(
      rankByPrice(models, 'input-price-high-to-low', 3).map((e) => e.id),
    ).toEqual(['b/y', 'a/x', 'c/z']);
  });

  it('is a permutation of its input, so no model is lost or doubled', () => {
    fc.assert(
      fc.property(entries, sorts, mixes, (models, sort, mix) => {
        const ranked = rankByPrice(models, sort, mix);
        expect(ranked.map((e) => e.id).sort()).toEqual(
          models.map((e) => e.id).sort(),
        );
      }),
    );
  });

  it('never lowers the price along a low-to-high order, and never raises it along a high-to-low one', () => {
    fc.assert(
      fc.property(entries, sorts, mixes, (models, sort, mix) => {
        const keys = rankByPrice(models, sort, mix)
          .map((entry) => keyOf(entry, sort, mix))
          .filter((key): key is number => key !== null);
        const step = sort.endsWith('low-to-high')
          ? (a: number, b: number) => a <= b
          : (a: number, b: number) => a >= b;
        for (let i = 1; i < keys.length; i += 1) {
          expect(step(keys[i - 1] as number, keys[i] as number)).toBe(true);
        }
      }),
    );
  });

  it('puts every model with no price after every model with one', () => {
    fc.assert(
      fc.property(entries, sorts, mixes, (models, sort, mix) => {
        const missing = rankByPrice(models, sort, mix).map(
          (entry) => keyOf(entry, sort, mix) === null,
        );
        expect(missing).toEqual([...missing].sort((a, b) => +a - +b));
      }),
    );
  });

  it('orders equal prices by id', () => {
    fc.assert(
      fc.property(entries, sorts, mixes, (models, sort, mix) => {
        const ranked = rankByPrice(models, sort, mix);
        for (let i = 1; i < ranked.length; i += 1) {
          const [a, b] = [ranked[i - 1], ranked[i]] as [Priced, Priced];
          if (keyOf(a, sort, mix) === keyOf(b, sort, mix)) {
            expect(a.id < b.id).toBe(true);
          }
        }
      }),
    );
  });

  it('gives the same order for the same input, whatever order it arrives in', () => {
    fc.assert(
      fc.property(entries, sorts, mixes, (models, sort, mix) => {
        const forward = rankByPrice(models, sort, mix).map((e) => e.id);
        const backward = rankByPrice([...models].reverse(), sort, mix).map(
          (e) => e.id,
        );
        expect(backward).toEqual(forward);
      }),
    );
  });

  it('does not change the list it was given', () => {
    const models = [item('b/y', 2, 1), item('a/x', 1, 1)];
    rankByPrice(models, 'input-price-low-to-high', 3);
    expect(models.map((entry) => entry.id)).toEqual(['b/y', 'a/x']);
  });
});

describe('blendedPrice', () => {
  it('lies between the input price and the output price', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        mixes,
        (input, output, mix) => {
          const blended = blendedPrice(item('a/x', input, output), mix);
          expect(blended).not.toBeNull();
          expect(blended as number).toBeGreaterThanOrEqual(
            Math.min(input, output) - 1e-9,
          );
          expect(blended as number).toBeLessThanOrEqual(
            Math.max(input, output) + 1e-9,
          );
        },
      ),
    );
  });

  it('is null when either price is missing', () => {
    expect(blendedPrice(item('a/x', null, 1), 3)).toBeNull();
    expect(blendedPrice(item('a/x', 1, null), 3)).toBeNull();
  });
});

describe('isPaid', () => {
  it.each([
    [item('a/x', 0, 0), false],
    [item('a/x', null, 1), false],
    [item('a/x', 1, null), false],
    [item('a/x', null, null), false],
    [item('a/x', 0.007, 6.8), true],
    [item('a/x', 1, 0), true],
    [item('a/x', 0, 1), true],
  ])('says %j is paid: %s', (entry, paid) => {
    expect(isPaid(entry)).toBe(paid);
  });
});
