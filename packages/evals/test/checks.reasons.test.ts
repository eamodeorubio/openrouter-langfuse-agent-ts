import { describe, expect, it } from 'vitest';
import {
  askedFigures,
  askedModelFound,
  inventedModels,
  memoryAnswer,
  runFailed,
} from '../src/checks/assertions.js';

const getModel = (id: string, prompt: number, completion: number) => ({
  round: 1,
  name: 'get_model',
  arguments: '{}',
  output: JSON.stringify({
    id,
    context_length: 131072,
    pricing: { prompt, completion },
  }),
  failed: false,
});

const success = (
  answer: string,
  toolCalls: unknown[] = [],
  question = 'q',
) => ({
  question,
  answer,
  success: true,
  toolCalls,
});

const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

describe('the reason of every verdict', () => {
  it('run-failed', () => {
    expect(runFailed(undefined).reason).toBe(
      'The output is not a success object of the CLI.',
    );
    expect(runFailed(success('')).reason).toBe('The answer is empty.');
    expect(runFailed(success('Yes')).reason).toBe('The run has an answer.');
  });

  it('memory-answer', () => {
    const needs = meta({ needsLookup: true });
    expect(memoryAnswer(success(''), needs).reason).toBe('Left to run-failed.');
    expect(memoryAnswer(undefined, needs).reason).toBe('Left to run-failed.');
    expect(memoryAnswer(success('x'), meta({})).reason).toBe(
      'The case needs no lookup.',
    );
    expect(memoryAnswer(success('x'), needs).reason).toBe(
      'The case needs a lookup and no tool call succeeded.',
    );
    expect(
      memoryAnswer(success('x', [getModel('a/b', 1, 1)]), needs).reason,
    ).toBe('A tool call succeeded.');
  });

  it('invented-data', () => {
    const calls = [getModel('openai/gpt-5', 1, 4)];
    expect(inventedModels(success('x')).reason).toBe(
      'Left to an earlier class.',
    );
    expect(inventedModels(success('openai/gpt-5', calls)).reason).toBe(
      'Every model the answer names is in the question or in a tool output.',
    );
    expect(
      inventedModels(success('openai/gpt-8 and openai/gpt-9', calls)).reason,
    ).toBe('No source holds: openai/gpt-8, openai/gpt-9.');
  });

  it('invented-data reads the question and each tool output as separate texts', () => {
    // Joined without a break, "openai/gpt-5" and "anthropic/claude-x" would run into one token.
    const calls = [{ ...getModel('x/y', 1, 1), output: 'anthropic/claude-x' }];
    const run = success(
      'openai/gpt-5 and anthropic/claude-x',
      calls,
      'Compare openai/gpt-5',
    );
    expect(inventedModels(run).pass).toBe(true);
  });

  it('wrong-search', () => {
    const asked = meta({ askedModel: 'a/b' });
    expect(askedModelFound(success('x'), asked).reason).toBe(
      'Nothing to find.',
    );
    expect(
      askedModelFound(success('x', [getModel('a/b', 1, 1)]), {}).reason,
    ).toBe('Nothing to find.');
    expect(
      askedModelFound(success('x', [getModel('a/b', 1, 1)]), asked).reason,
    ).toBe('A tool output holds a/b.');
    expect(
      askedModelFound(success('x', [getModel('c/d', 1, 1)]), asked).reason,
    ).toBe('No tool output holds a/b.');
  });

  it('wrong-value', () => {
    const calls = [getModel('a/b', 0.05, 0.2)];
    const all = meta({
      askedModel: 'a/b',
      askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
    });
    expect(askedFigures(success('x'), all).reason).toBe('Nothing to compare.');
    expect(
      askedFigures(success('x', calls), meta({ askedFigures: ['inputPrice'] }))
        .reason,
    ).toBe('Nothing to compare.');
    expect(
      askedFigures(success('x', calls), meta({ askedModel: 'a/b' })).reason,
    ).toBe('Nothing to compare.');
    expect(
      askedFigures(success('x', [getModel('c/d', 1, 1)]), all).reason,
    ).toBe('Left to wrong-search.');
    expect(
      askedFigures(success('$0.05, $0.2 and 131,072 tokens', calls), all)
        .reason,
    ).toBe('The answer holds every asked figure.');
    expect(askedFigures(success('nothing here', calls), all).reason).toBe(
      'The answer lacks the figure the tool returned: inputPrice, outputPrice, contextLength.',
    );
  });

  it('wrong-value ignores a figure name it does not know, and a null price', () => {
    const calls = [
      {
        ...getModel('a/b', 1, 1),
        output: JSON.stringify({
          id: 'a/b',
          context_length: 8,
          pricing: { prompt: null, completion: null },
        }),
      },
    ];
    const asked = meta({
      askedModel: 'a/b',
      askedFigures: ['inputPrice', 'outputPrice', 'colour'],
    });
    expect(askedFigures(success('no figures', calls), asked).pass).toBe(true);
  });

  it('wrong-value says nothing about a figure the output does not hold', () => {
    const calls = [
      {
        ...getModel('a/b', 1, 1),
        output: JSON.stringify({ id: 'a/b', pricing: {} }),
      },
    ];
    const asked = meta({
      askedModel: 'a/b',
      askedFigures: ['inputPrice', 'outputPrice', 'contextLength'],
    });
    expect(askedFigures(success('nothing', calls), asked).pass).toBe(true);
  });
});
