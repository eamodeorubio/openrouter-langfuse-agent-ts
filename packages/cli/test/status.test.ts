import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatStatus } from '../src/status.js';

describe('formatStatus', () => {
  it('prints the served model and the token usage, one line each', () => {
    const text = formatStatus({
      model: 'anthropic/claude-sonnet-5.5-20261001',
      usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
    });
    expect(text).toBe(
      'model: anthropic/claude-sonnet-5.5-20261001\ntokens: 12 prompt, 34 completion, 46 total\n',
    );
  });

  it.each([
    [11, '29 prompt, 2024 completion (11 reasoning), 2053 total'],
    [0, '29 prompt, 2024 completion, 2053 total'],
    [undefined, '29 prompt, 2024 completion, 2053 total'],
  ])('with reasoning tokens %s prints %s', (reasoningTokens, expected) => {
    const text = formatStatus({
      model: 'm',
      usage: {
        promptTokens: 29,
        completionTokens: 2024,
        totalTokens: 2053,
        reasoningTokens,
      },
    });
    expect(text).toBe(`model: m\ntokens: ${expected}\n`);
  });

  it('prints zero counts', () => {
    const text = formatStatus({
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(text).toBe('model: m\ntokens: 0 prompt, 0 completion, 0 total\n');
  });

  it('carries the model and the three counts verbatim for any non-negative integers', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !s.includes('\n')),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (model, promptTokens, completionTokens, totalTokens) => {
          const lines = formatStatus({
            model,
            usage: { promptTokens, completionTokens, totalTokens },
          }).split('\n');
          expect(lines).toEqual([
            `model: ${model}`,
            `tokens: ${promptTokens} prompt, ${completionTokens} completion, ${totalTokens} total`,
            '',
          ]);
        },
      ),
    );
  });

  it('shows the reasoning count exactly when it is above zero, for any counts', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.option(fc.nat(), { nil: undefined }),
        (promptTokens, completionTokens, totalTokens, reasoningTokens) => {
          const tokens = formatStatus({
            model: 'm',
            usage: {
              promptTokens,
              completionTokens,
              totalTokens,
              reasoningTokens,
            },
          }).split('\n')[1];
          const shown = (reasoningTokens ?? 0) > 0;
          expect(tokens).toBe(
            `tokens: ${promptTokens} prompt, ${completionTokens} completion${shown ? ` (${reasoningTokens} reasoning)` : ''}, ${totalTokens} total`,
          );
        },
      ),
    );
  });
});
