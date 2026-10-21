import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Usage } from '../src/types.js';
import { addUsage } from '../src/usage.js';

const usage = fc.record({
  promptTokens: fc.nat(1_000_000),
  completionTokens: fc.nat(1_000_000),
  totalTokens: fc.nat(1_000_000),
  reasoningTokens: fc.option(fc.nat(1_000_000), { nil: undefined }),
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
