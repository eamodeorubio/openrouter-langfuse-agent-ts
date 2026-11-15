import { describe, expect, it } from 'vitest';
import { modelIds, modelRecord } from '../src/checks/outputs.js';
import type { ToolCall } from '../src/checks/run.js';

const call = (
  output: unknown,
  overrides: Partial<ToolCall> = {},
): ToolCall => ({
  round: 1,
  name: 'get_model',
  arguments: '{}',
  output: typeof output === 'string' ? output : JSON.stringify(output),
  failed: false,
  ...overrides,
});

const getModel = (
  id: string,
  prompt: number | null,
  completion: number | null,
) =>
  call({
    id,
    context_length: 131072,
    pricing: { prompt, completion },
  });

const searchModels = (...entries: [string, number, number][]) =>
  call({
    total: entries.length,
    models: entries.map(([id, context, price]) => ({
      id,
      context_length: context,
      prompt_price: price,
      completion_price: price * 4,
    })),
  });

describe('what the run read about a model', () => {
  it('comes from a get_model output', () => {
    expect(modelRecord([getModel('a/b', 0.05, 0.2)], 'a/b')).toEqual({
      contextLength: 131072,
      promptPrice: 0.05,
      completionPrice: 0.2,
    });
  });

  it('comes from a search_models entry', () => {
    const calls = [searchModels(['x/y', 8000, 1], ['a/b', 200000, 0.5])];
    expect(modelRecord(calls, 'a/b')).toEqual({
      contextLength: 200000,
      promptPrice: 0.5,
      completionPrice: 2,
    });
  });

  it('keeps a null price, as a routing model has', () => {
    expect(
      modelRecord([getModel('openrouter/auto', null, null)], 'openrouter/auto'),
    ).toMatchObject({
      promptPrice: null,
      completionPrice: null,
    });
  });

  it('takes the first call that holds the model', () => {
    const calls = [getModel('a/b', 1, 2), getModel('a/b', 9, 9)];
    expect(modelRecord(calls, 'a/b')?.promptPrice).toBe(1);
  });

  it('ignores a failed call and an output that is not JSON', () => {
    const calls = [
      call('[API_ERROR] boom', { failed: true }),
      call('not json'),
      call(
        { id: 'a/b', context_length: 1, pricing: { prompt: 1, completion: 1 } },
        { failed: true },
      ),
    ];
    expect(modelRecord(calls, 'a/b')).toBeUndefined();
  });

  it('is undefined when no output holds the model', () => {
    expect(modelRecord([getModel('x/y', 1, 1)], 'a/b')).toBeUndefined();
    expect(modelRecord([], 'a/b')).toBeUndefined();
  });

  it('matches the slug whatever its case', () => {
    expect(modelRecord([getModel('A/B', 1, 1)], 'a/b')).toBeDefined();
  });
});

describe('the edges of what a run read', () => {
  it('skips an output that is the text null or a list', () => {
    expect(modelRecord([call('null'), call('[1,2]')], 'a/b')).toBeUndefined();
  });

  it('leaves out a price that is not a number and a context that is not a number', () => {
    const odd = call({
      id: 'a/b',
      context_length: 'big',
      pricing: { prompt: 'cheap', completion: 2 },
    });
    expect(modelRecord([odd], 'a/b')).toStrictEqual({ completionPrice: 2 });
  });

  it('reads a search entry that has no prices', () => {
    const search = call({ models: [{ id: 'a/b', context_length: 7 }] });
    expect(modelRecord([search], 'a/b')).toStrictEqual({ contextLength: 7 });
  });

  it('skips a search output whose models are not a list', () => {
    expect(modelRecord([call({ models: 'many' })], 'a/b')).toBeUndefined();
  });

  it('reads the pricing of a model that has none as no prices', () => {
    expect(
      modelRecord([call({ id: 'a/b', context_length: 3 })], 'a/b'),
    ).toEqual({
      contextLength: 3,
    });
  });
});

describe('the ids of the models the run read', () => {
  it('are the id of a get_model result and the ids of a search page, in lower case', () => {
    const calls = [
      call({ id: 'OpenAI/GPT-5', pricing: {} }),
      call({
        models: [{ id: 'a/b' }, { id: 'c/d:free' }, { name: 'no id' }, 'x'],
      }),
    ];
    expect(modelIds(calls)).toEqual(['openai/gpt-5', 'a/b', 'c/d:free']);
  });

  it('skip a failed call, text that is not JSON and an id that is not text', () => {
    const calls = [
      call({ id: 'a/b' }, { failed: true }),
      call('not json'),
      call({ id: 7 }),
      call('null'),
    ];
    expect(modelIds(calls)).toEqual([]);
  });
});
