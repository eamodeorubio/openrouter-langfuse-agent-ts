import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenBuckets } from '../src/tracing/buckets.js';

describe('tokenBuckets', () => {
  it.each([
    [
      'prompt and completion only',
      { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      { input: 100, output: 40, total: 140 },
      {},
    ],
    [
      'cached and reasoning tokens inside the prompt and the completion',
      {
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
        cachedTokens: 30,
        reasoningTokens: 15,
      },
      {
        input: 70,
        input_cached_tokens: 30,
        output: 25,
        output_reasoning_tokens: 15,
        total: 140,
      },
      {},
    ],
    [
      'more reasoning than completion, as a recorded run reports',
      {
        promptTokens: 25,
        completionTokens: 122,
        totalTokens: 147,
        reasoningTokens: 128,
      },
      { input: 25, output: 122, total: 147 },
      { reasoning_tokens: 128 },
    ],
    [
      'more cached tokens than prompt tokens',
      {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cachedTokens: 30,
      },
      { input: 10, output: 5, total: 15 },
      { cached_tokens: 30 },
    ],
    [
      'counts that are reported as zero',
      {
        promptTokens: 24,
        completionTokens: 16,
        totalTokens: 40,
        cachedTokens: 0,
        reasoningTokens: 0,
      },
      {
        input: 24,
        input_cached_tokens: 0,
        output: 16,
        output_reasoning_tokens: 0,
        total: 40,
      },
      {},
    ],
    [
      'all the cached tokens, and all the reasoning',
      {
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
        cachedTokens: 10,
        reasoningTokens: 8,
      },
      {
        input: 0,
        input_cached_tokens: 10,
        output: 0,
        output_reasoning_tokens: 8,
        total: 18,
      },
      {},
    ],
  ])('gives the buckets for %s', (_name, usage, details, metadata) => {
    expect(tokenBuckets(usage)).toStrictEqual({ details, metadata });
  });

  it('makes the total the sum of the buckets, not the figure the provider reports', () => {
    expect(
      tokenBuckets({ promptTokens: 3, completionTokens: 4, totalTokens: 99 })
        .details.total,
    ).toBe(7);
  });

  const count = fc.integer({ min: 0, max: 1_000_000 });
  const usage = fc.record({
    promptTokens: count,
    completionTokens: count,
    totalTokens: count,
    cachedTokens: fc.option(count, { nil: undefined }),
    reasoningTokens: fc.option(count, { nil: undefined }),
  });

  it('keeps every bucket at zero or more, and the buckets summing to the total, for any counts', () => {
    fc.assert(
      fc.property(usage, (reported) => {
        const { details } = tokenBuckets(reported);
        const { total, ...parts } = details;
        for (const value of Object.values(details)) {
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(total);
      }),
    );
  });

  it('never counts a token twice: the prompt and the completion are what the buckets add up to, when no count is odd', () => {
    fc.assert(
      fc.property(
        count,
        count,
        fc.nat(100),
        fc.nat(100),
        (prompt, completion, cachedPct, reasoningPct) => {
          const cachedTokens = Math.floor((prompt * cachedPct) / 100);
          const reasoningTokens = Math.floor((completion * reasoningPct) / 100);
          const { details, metadata } = tokenBuckets({
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: 0,
            cachedTokens,
            reasoningTokens,
          });
          expect(details.total).toBe(prompt + completion);
          expect(metadata).toEqual({});
        },
      ),
    );
  });

  it('leaves the odd count in the metadata and the bucket whole', () => {
    fc.assert(
      fc.property(count, fc.integer({ min: 1, max: 1000 }), (prompt, extra) => {
        const { details, metadata } = tokenBuckets({
          promptTokens: prompt,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: prompt + extra,
        });
        expect(details.input).toBe(prompt);
        expect(details).not.toHaveProperty('input_cached_tokens');
        expect(metadata).toEqual({ cached_tokens: prompt + extra });
      }),
    );
  });
});
