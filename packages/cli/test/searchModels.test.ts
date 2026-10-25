import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { nextOffset, searchModels } from '../src/tools/searchModels.js';
import { recordedModelsList } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const client = createClient('sk-test-key');
const parse = (args: unknown) => searchModels.parameters.safeParse(args);
type Args = ReturnType<typeof searchModels.parameters.parse>;

/** Runs the tool with the given arguments and gives back the query the API saw. */
const queryFor = async (args: Record<string, unknown>) => {
  let seen: Record<string, string> = {};
  nock(HOST)
    .get('/api/v1/models')
    .query((query) => {
      seen = query as Record<string, string>;
      return true;
    })
    .reply(200, recordedModelsList);
  const result = await searchModels.run(parse(args).data as Args, {
    client,
    timeoutMs: 60_000,
  });
  expect(result.ok).toBe(true);
  return seen;
};

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('search_models arguments', () => {
  it('accepts no argument at all and fills in the page', () => {
    expect(parse({}).data).toMatchObject({ limit: 10, offset: 0 });
  });

  it.each([
    [{ query: 'claude' }],
    [{ category: 'programming' }],
    [{ category: 'marketing/seo' }],
    [{ sort: 'pricing-low-to-high' }],
    [{ input_modalities: ['image', 'text'] }],
    [{ output_modalities: ['text'] }],
    [{ supported_parameters: ['tools', 'reasoning'] }],
    [{ min_context_length: 1_000_000 }],
    [{ min_prompt_price: 0, max_prompt_price: 2.5 }],
    [{ min_completion_price: 0.1, max_completion_price: 10 }],
    [{ architecture: 'Claude', authors: ['openai'], providers: ['Together'] }],
    [
      {
        min_intelligence_index: 40,
        min_coding_index: 30,
        min_agentic_index: 20,
      },
    ],
    [{ min_tool_success_rate: 0.9 }],
    [{ max_age_days: 0 }],
    [{ zero_data_retention: true }],
    [{ limit: 50, offset: 100 }],
  ])('accepts %j', (args) => {
    expect(parse(args).success).toBe(true);
  });

  it.each([
    [{ limit: 1 }, true],
    [{ limit: 50 }, true],
    [{ limit: 0 }, false],
    [{ limit: 51 }, false],
    [{ limit: 2.5 }, false],
    [{ limit: 'ten' }, false],
    [{ offset: -1 }, false],
    [{ offset: 1.5 }, false],
    [{ min_context_length: 0 }, false],
    [{ min_prompt_price: -0.1 }, false],
    [{ max_completion_price: -1 }, false],
    [{ min_tool_success_rate: 1.1 }, false],
    [{ min_tool_success_rate: -0.1 }, false],
    [{ max_age_days: -1 }, false],
    [{ max_age_days: 1.5 }, false],
    [{ category: 'cooking' }, false],
    [{ sort: 'best' }, false],
    [{ supported_parameters: 'tools' }, false],
    [{ authors: 'openai' }, false],
    [{ query: 5 }, false],
    [{ zero_data_retention: 'yes' }, false],
    [{ frobnicate: 1 }, false],
  ])('%j is valid: %s', (args, valid) => {
    expect(parse(args).success).toBe(valid);
  });

  it('reads null as absent for every optional argument, because some providers fill them all', () => {
    const allNull = Object.fromEntries(
      Object.keys(searchModels.parameters.shape).map((key) => [key, null]),
    );
    expect(parse(allNull).data).toEqual({ limit: 10, offset: 0 });
  });

  it('still refuses a wrong type, null aside', () => {
    expect(parse({ limit: null, query: 5 }).success).toBe(false);
  });

  it('never throws, whatever the model sends', () => {
    fc.assert(
      fc.property(fc.anything(), (args) => {
        expect(() => parse(args)).not.toThrow();
      }),
    );
  });
});

describe('search_models request', () => {
  it('sends the defaults: a page of 10 from the start', async () => {
    expect(await queryFor({})).toMatchObject({ limit: '10', offset: '0' });
  });

  it.each([
    [{ query: 'claude' }, { q: 'claude' }],
    [{ category: 'programming' }, { category: 'programming' }],
    [{ sort: 'newest' }, { sort: 'newest' }],
    [
      { input_modalities: ['image', 'text'] },
      { input_modalities: 'image,text' },
    ],
    [{ output_modalities: ['text'] }, { output_modalities: 'text' }],
    [
      { supported_parameters: ['tools', 'reasoning'] },
      { supported_parameters: 'tools,reasoning' },
    ],
    [{ min_context_length: 200000 }, { context: '200000' }],
    [{ min_prompt_price: 0.5 }, { min_price: '0.5' }],
    [{ max_prompt_price: 2 }, { max_price: '2' }],
    [{ min_completion_price: 1 }, { min_output_price: '1' }],
    [{ max_completion_price: 10 }, { max_output_price: '10' }],
    [{ architecture: 'Claude' }, { arch: 'Claude' }],
    [
      { authors: ['openai', 'anthropic'] },
      { model_authors: 'openai,anthropic' },
    ],
    [
      { providers: ['Together', 'Fireworks'] },
      { providers: 'Together,Fireworks' },
    ],
    [{ min_intelligence_index: 40 }, { min_intelligence_index: '40' }],
    [{ min_coding_index: 30 }, { min_coding_index: '30' }],
    [{ min_agentic_index: 20 }, { min_agentic_index: '20' }],
    [{ min_tool_success_rate: 0.9 }, { min_tool_success_rate: '0.9' }],
    [{ max_age_days: 30 }, { max_age_days: '30' }],
    [{ zero_data_retention: true }, { zdr: 'true' }],
    [
      { limit: 5, offset: 20 },
      { limit: '5', offset: '20' },
    ],
  ])('turns %j into %j', async (args, expected) => {
    expect(await queryFor(args)).toMatchObject(expected);
  });

  it('sends no zdr filter when zero_data_retention is false', async () => {
    expect(await queryFor({ zero_data_retention: false })).not.toHaveProperty(
      'zdr',
    );
  });

  it('sends nothing for the arguments the model left null', async () => {
    const query = await queryFor({
      query: null,
      sort: null,
      limit: null,
      offset: null,
    });
    expect(Object.keys(query).sort()).toEqual(['limit', 'offset']);
  });

  it('sends only what the model gave, plus the page', async () => {
    expect(Object.keys(await queryFor({ query: 'x' })).sort()).toEqual([
      'limit',
      'offset',
      'q',
    ]);
  });

  it('sends the key as a bearer token', async () => {
    const scope = nock(HOST, {
      reqheaders: { authorization: 'Bearer sk-test-key' },
    })
      .get('/api/v1/models')
      .query(true)
      .reply(200, recordedModelsList);
    await searchModels.run(parse({}).data as Args, {
      client,
      timeoutMs: 60_000,
    });
    expect(scope.isDone()).toBe(true);
  });
});

describe('search_models result', () => {
  const resultFor = async (
    body: unknown,
    args: Record<string, unknown> = {},
  ) => {
    nock(HOST).get('/api/v1/models').query(true).reply(200, body);
    const result = await searchModels.run(parse(args).data as Args, {
      client,
      timeoutMs: 60_000,
    });
    if (!result.ok) {
      throw new Error(result.message);
    }
    return JSON.parse(JSON.stringify(result.value));
  };

  it('holds the total, the offset, the next offset and the models in the API order', async () => {
    const page = await resultFor(recordedModelsList);
    expect(Object.keys(page).sort()).toEqual([
      'models',
      'next_offset',
      'offset',
      'total',
    ]);
    expect(page.total).toBe(375);
    expect(page.offset).toBe(0);
    expect(page.next_offset).toBe(2);
    expect(page.models.map((m: { id: string }) => m.id)).toEqual(
      recordedModelsList.data.map((m) => m.id),
    );
  });

  it('holds exactly the listed fields of each model and no description', async () => {
    const page = await resultFor(recordedModelsList);
    for (const model of page.models) {
      expect(Object.keys(model).sort()).toEqual(
        [
          'id',
          'name',
          'context_length',
          'max_completion_tokens',
          'prompt_price',
          'completion_price',
          'input_modalities',
          'output_modalities',
          'supports_reasoning',
          'intelligence_index',
          'coding_index',
          'agentic_index',
          'created',
        ].sort(),
      );
    }
  });

  it('prices in USD per million tokens, and gives null for a price that is not one', async () => {
    const priced = (prompt: string, completion: string) => ({
      ...recordedModelsList,
      data: [
        { ...recordedModelsList.data[0], pricing: { prompt, completion } },
      ],
    });
    const page = await resultFor(priced('0.0000015', '-1'));
    expect(page.models[0].prompt_price).toBe(1.5);
    expect(page.models[0].completion_price).toBeNull();
  });

  it('says whether a model reasons, from the reasoning field the API gives it', async () => {
    const { reasoning: _dropped, ...plain } = recordedModelsList
      .data[0] as Record<string, unknown>;
    const page = await resultFor({
      ...recordedModelsList,
      data: [recordedModelsList.data[0], plain],
    });
    expect(
      page.models.map(
        (m: { supports_reasoning: boolean }) => m.supports_reasoning,
      ),
    ).toEqual([true, false]);
  });

  it('gives null for the indices a model has no score for', async () => {
    const page = await resultFor(recordedModelsList);
    expect(page.models[1]).toMatchObject({
      intelligence_index: null,
      coding_index: null,
      agentic_index: null,
    });
  });

  it('continues from the offset the model asked for', async () => {
    const page = await resultFor(recordedModelsList, { offset: 40 });
    expect(page.offset).toBe(40);
    expect(page.next_offset).toBe(42);
  });

  it('gives a null next offset on the last page', async () => {
    const page = await resultFor({
      ...recordedModelsList,
      links: { next: null },
    });
    expect(page.next_offset).toBeNull();
  });

  it('gives an empty page when nothing matches', async () => {
    const page = await resultFor({
      data: [],
      total_count: 0,
      links: { next: null },
    });
    expect(page).toEqual({
      total: 0,
      offset: 0,
      next_offset: null,
      models: [],
    });
  });

  it('gives null indices when the model has benchmarks but none from Artificial Analysis', async () => {
    const arena = {
      ...recordedModelsList.data[0],
      benchmarks: { design_arena: [] },
    };
    const page = await resultFor({ ...recordedModelsList, data: [arena] });
    expect(page.models[0]).toMatchObject({
      intelligence_index: null,
      coding_index: null,
      agentic_index: null,
    });
  });

  it('reports a page whose models lack a required field as a malformed response', async () => {
    const { pricing: _dropped, ...noPricing } = recordedModelsList
      .data[0] as Record<string, unknown>;
    nock(HOST)
      .get('/api/v1/models')
      .query(true)
      .reply(200, { ...recordedModelsList, data: [noPricing] });
    const result = await searchModels.run(parse({}).data as Args, {
      client,
      timeoutMs: 60_000,
    });
    expect(result).toEqual({
      ok: false,
      message:
        'OpenRouter sent a reply this tool could not read. Try again, or choose another model.',
    });
  });

  it('reports a 404 as an API error, since a search has no model to miss', async () => {
    nock(HOST)
      .get('/api/v1/models')
      .query(true)
      .reply(404, { error: { message: 'gone', code: 404 } });
    const result = await searchModels.run(parse({}).data as Args, {
      client,
      timeoutMs: 60_000,
    });
    expect((result as { message: string }).message).toMatch(
      /^API error 404: .*gone/,
    );
  });

  it('reports an API failure as a result for the model', async () => {
    nock(HOST)
      .get('/api/v1/models')
      .query(true)
      .reply(400, { error: { message: 'bad filter', code: 400 } });
    const result = await searchModels.run(parse({}).data as Args, {
      client,
      timeoutMs: 60_000,
    });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(
      /^API error 400: .*bad filter/,
    );
  });
});

describe('nextOffset', () => {
  it('is the offset plus the page when the API has a next page', () => {
    expect(nextOffset(20, 10, true)).toBe(30);
  });

  it.each([
    [0, 10, false],
    [20, 0, true],
    [20, 0, false],
  ])(
    'is null for offset %s, count %s, next page %s',
    (offset, count, hasNext) => {
      expect(nextOffset(offset, count, hasNext)).toBeNull();
    },
  );

  it('is either null or beyond the offset, so a model that follows it always moves forward', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.nat(50),
        fc.boolean(),
        (offset, count, hasNext) => {
          const next = nextOffset(offset, count, hasNext);
          expect(next === null || next > offset).toBe(true);
        },
      ),
    );
  });
});
