import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Usage } from '../src/types.js';
import { addUsage } from '../src/usage.js';

const usage = fc.record({
  promptTokens: fc.nat(1_000_000),
  completionTokens: fc.nat(1_000_000),
  totalTokens: fc.nat(1_000_000),
  reasoningTokens: fc.option(fc.nat(1_000_000), { nil: undefined }),
  cachedTokens: fc.option(fc.nat(1_000_000), { nil: undefined }),
  // Whole numbers, so that the sums are exact and their order cannot matter.
  cost: fc.option(fc.nat(1_000_000), { nil: undefined }),
});

const base: Usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };

describe('addUsage', () => {
  it('adds each count', () => {
    expect(
      addUsage(base, {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      }),
    ).toEqual({
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
      reasoningTokens: undefined,
      cachedTokens: undefined,
      cost: undefined,
    });
  });

  it.each([
    [5, undefined, 5],
    [undefined, 3, 3],
    [5, 3, 8],
    [0, 0, 0],
    [undefined, undefined, undefined],
  ])('with reasoning %s and %s gives %s', (a, b, sum) => {
    expect(
      addUsage({ ...base, reasoningTokens: a }, { ...base, reasoningTokens: b })
        .reasoningTokens,
    ).toBe(sum);
  });

  it.each([
    [5, undefined, 5],
    [undefined, 3, 3],
    [7, 3, 10],
    [0, 0, 0],
    [undefined, undefined, undefined],
  ])('with cached tokens %s and %s gives %s', (a, b, sum) => {
    expect(
      addUsage({ ...base, cachedTokens: a }, { ...base, cachedTokens: b })
        .cachedTokens,
    ).toBe(sum);
  });

  it.each([
    [0.5, 0.25, 0.75],
    [0, 0, 0],
    [0.5, undefined, undefined],
    [undefined, 0.25, undefined],
    [undefined, undefined, undefined],
  ])('with cost %s and %s gives %s', (a, b, sum) => {
    expect(addUsage({ ...base, cost: a }, { ...base, cost: b }).cost).toBe(sum);
  });

  it('sums every figure, and has a cost exactly when every usage added has one', () => {
    const total = (values: (number | undefined)[]) =>
      values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    fc.assert(
      fc.property(fc.array(usage, { minLength: 1 }), (usages) => {
        const sum = usages.slice(1).reduce<Usage>(addUsage, usages[0] as Usage);
        const each = (pick: (u: Usage) => number | undefined) =>
          usages.map(pick);
        expect(sum.promptTokens).toBe(total(each((u) => u.promptTokens)));
        expect(sum.totalTokens).toBe(total(each((u) => u.totalTokens)));
        const costs = each((u) => u.cost);
        expect(sum.cost).toBe(
          costs.every((c) => c !== undefined) ? total(costs) : undefined,
        );
        const cached = each((u) => u.cachedTokens);
        expect(sum.cachedTokens).toBe(
          cached.some((c) => c !== undefined) ? total(cached) : undefined,
        );
        const reasoning = each((u) => u.reasoningTokens);
        expect(sum.reasoningTokens).toBe(
          reasoning.some((c) => c !== undefined) ? total(reasoning) : undefined,
        );
      }),
    );
  });

  it('adds costs as floating-point numbers, without rounding', () => {
    expect(addUsage({ ...base, cost: 0.1 }, { ...base, cost: 0.2 }).cost).toBe(
      0.1 + 0.2,
    );
  });

  it('is commutative and associative, so the order of rounds does not matter', () => {
    fc.assert(
      fc.property(usage, usage, usage, (a, b, c) => {
        expect(addUsage(a, b)).toEqual(addUsage(b, a));
        expect(addUsage(addUsage(a, b), c)).toEqual(
          addUsage(a, addUsage(b, c)),
        );
      }),
    );
  });

  it('never lowers a count', () => {
    fc.assert(
      fc.property(usage, usage, (a, b) => {
        const sum = addUsage(a, b);
        expect(sum.promptTokens).toBeGreaterThanOrEqual(a.promptTokens);
        expect(sum.totalTokens).toBeGreaterThanOrEqual(b.totalTokens);
      }),
    );
  });
});
