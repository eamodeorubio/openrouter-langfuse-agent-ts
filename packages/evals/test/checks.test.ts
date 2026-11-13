import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  askedFigures,
  askedModelFound,
  inventedModels,
  memoryAnswer,
  runFailed,
} from '../src/checks/assertions.js';

interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const getModel = (
  id: string,
  prompt: number,
  completion: number,
  context = 131072,
  failed = false,
): Call => ({
  round: 1,
  name: 'get_model',
  arguments: JSON.stringify({ slug: id }),
  output: JSON.stringify({
    id,
    context_length: context,
    pricing: { prompt, completion },
  }),
  failed,
});

const success = (answer: string, toolCalls: Call[] = [], question = 'q') => ({
  question,
  answer,
  success: true,
  toolCalls,
});

const withMeta = (metadata: Record<string, unknown> = {}) => ({
  test: { metadata },
});

const needsLookup = withMeta({ needsLookup: true });

describe('run-failed', () => {
  it('fails a blank answer', () => {
    expect(runFailed(success('  '), withMeta()).pass).toBe(false);
  });

  it('fails an output that is not a success object', () => {
    expect(runFailed('plain text', withMeta()).pass).toBe(false);
    expect(runFailed(undefined, withMeta()).pass).toBe(false);
  });

  it('passes an answer', () => {
    expect(runFailed(success('An answer.'), withMeta()).pass).toBe(true);
  });
});

describe('memory-answer', () => {
  it('fails a case that needs a lookup when no tool call was made', () => {
    expect(memoryAnswer(success('It costs $1.'), needsLookup).pass).toBe(false);
  });

  it('fails when every call failed', () => {
    const calls = [
      getModel('a/b', 1, 1, 1, true),
      getModel('a/b', 1, 1, 1, true),
    ];
    expect(memoryAnswer(success('x', calls), needsLookup).pass).toBe(false);
  });

  it('passes when one call succeeded', () => {
    const calls = [getModel('a/b', 1, 1, 1, true), getModel('a/b', 1, 1)];
    expect(memoryAnswer(success('x', calls), needsLookup).pass).toBe(true);
  });

  it('passes a case that does not need a lookup', () => {
    expect(
      memoryAnswer(success('3.00 USD'), withMeta({ needsLookup: false })).pass,
    ).toBe(true);
    expect(memoryAnswer(success('3.00 USD'), withMeta()).pass).toBe(true);
  });

  it('passes without judging when the run failed', () => {
    expect(memoryAnswer(success(''), needsLookup).pass).toBe(true);
  });
});

describe('invented-data', () => {
  const calls = [getModel('openai/gpt-5', 1, 4)];

  it('fails a model that no source holds', () => {
    const result = inventedModels(
      success('I recommend openai/gpt-9.', calls),
      withMeta(),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('openai/gpt-9');
  });

  it('passes a model a tool returned', () => {
    expect(
      inventedModels(success('Use openai/gpt-5.', calls), withMeta()).pass,
    ).toBe(true);
  });

  it('passes a model the question named', () => {
    const run = success(
      'openai/gpt-4 is older.',
      calls,
      'Compare openai/gpt-4 and openai/gpt-5',
    );
    expect(inventedModels(run, withMeta()).pass).toBe(true);
  });

  it('judges a model in backticks, whatever its author', () => {
    expect(
      inventedModels(success('Try `fakeco/x-1`.', calls), withMeta()).pass,
    ).toBe(false);
  });

  it('does not take a slash in the prose of a tool output for the author of a model', () => {
    const noisy = [
      {
        ...getModel('openai/gpt-5', 1, 4),
        output: JSON.stringify({
          id: 'openai/gpt-5',
          description: 'Reads text/plain and image/png input.',
          pricing: { prompt: 1, completion: 4 },
        }),
      },
    ];
    const run = success('It reads text/image and openai/gpt-5.', noisy);
    expect(inventedModels(run, withMeta()).pass).toBe(true);
  });

  it('judges an author the question or a tool result named, whoever else is quiet', () => {
    const calls = [getModel('openai/gpt-5', 1, 4)];
    expect(
      inventedModels(
        success(
          'anthropic/claude-x is cheaper.',
          calls,
          'Compare anthropic/claude-x',
        ),
        withMeta(),
      ).pass,
    ).toBe(true);
    expect(
      inventedModels(
        success(
          'anthropic/claude-y is cheaper.',
          calls,
          'Compare anthropic/claude-x',
        ),
        withMeta(),
      ).pass,
    ).toBe(false);
  });

  it('does not take input/output or 24/7 for models', () => {
    expect(
      inventedModels(success('input/output, 24/7 support', calls), withMeta())
        .pass,
    ).toBe(true);
  });

  it('leaves a run with no successful lookup to memory-answer', () => {
    expect(inventedModels(success('Use openai/gpt-9.'), withMeta()).pass).toBe(
      true,
    );
    const failedOnly = [getModel('openai/gpt-5', 1, 1, 1, true)];
    expect(
      inventedModels(success('Use openai/gpt-9.', failedOnly), withMeta()).pass,
    ).toBe(true);
  });

  it('leaves a failed run to run-failed', () => {
    expect(inventedModels(success('', calls), withMeta()).pass).toBe(true);
  });
});

describe('the asked model, for wrong-search', () => {
  const asked = withMeta({ askedModel: 'a/b' });

  it('fails when no output holds the model', () => {
    const result = askedModelFound(
      success('x', [getModel('x/y', 1, 1)]),
      asked,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('a/b');
  });

  it('passes when an output holds it', () => {
    expect(
      askedModelFound(success('x', [getModel('a/b', 1, 1)]), asked).pass,
    ).toBe(true);
  });

  it('passes a case that asks about no model', () => {
    expect(
      askedModelFound(success('x', [getModel('x/y', 1, 1)]), withMeta()).pass,
    ).toBe(true);
  });

  it('leaves a run with no successful lookup to memory-answer', () => {
    expect(askedModelFound(success('x'), asked).pass).toBe(true);
  });
});

describe('the asked figures, for wrong-value', () => {
  const asked = withMeta({
    askedModel: 'a/b',
    askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
  });
  const calls = [getModel('a/b', 0.05, 0.2, 131072)];

  it('passes an answer that holds every figure the output holds', () => {
    const answer =
      'It costs $0.05 in and $0.20 out per million, with a 131,072 token window.';
    expect(askedFigures(success(answer, calls), asked).pass).toBe(true);
  });

  it('fails a wrong price and names the figure', () => {
    const answer =
      'It costs $0.50 in and $0.20 out per million, with a 131k window.';
    const result = askedFigures(success(answer, calls), asked);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('inputPrice');
  });

  it('fails a missing context length', () => {
    const answer = 'It costs $0.05 in and $0.20 out per million.';
    const result = askedFigures(success(answer, calls), asked);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('contextLength');
  });

  it('leaves a run whose lookups never held the model to wrong-search', () => {
    expect(
      askedFigures(success('nothing', [getModel('x/y', 1, 1)]), asked).pass,
    ).toBe(true);
  });

  it('leaves a run with no successful lookup to memory-answer', () => {
    expect(askedFigures(success('$9'), asked).pass).toBe(true);
  });

  it('checks only the figures the case names', () => {
    const onlyContext = withMeta({
      askedModel: 'a/b',
      askedFigures: ['contextLength'],
    });
    expect(
      askedFigures(success('A 131072 token window.', calls), onlyContext).pass,
    ).toBe(true);
  });
});

describe('every check, for any output and any case', () => {
  const checks = [
    runFailed,
    memoryAnswer,
    inventedModels,
    askedModelFound,
    askedFigures,
  ];

  it('never throws and returns a verdict', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of checks) {
          const result = check(output, context as never);
          expect(typeof result.pass).toBe('boolean');
          expect(typeof result.reason).toBe('string');
          expect(result.score).toBe(result.pass ? 1 : 0);
        }
      }),
    );
  });
});
