import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { createCatalogCache } from '../src/tools/catalogCache.js';
import { callTool, functionTools, TOOLS } from '../src/tools/registry.js';
import type { ToolContext } from '../src/tools/types.js';
import { recordedModelsList } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const client = createClient('sk-test-key');
const template = recordedModelsList.data[0] as Record<string, unknown>;

const model = (id: string, parameters: string[] = [], prompt = '0.000001') => ({
  ...template,
  id,
  supported_parameters: parameters,
  pricing: { prompt, completion: prompt },
});

const list = (models: object[], next: string | null = null) => ({
  data: models,
  total_count: models.length,
  links: { next },
});

const FIVE = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'].map((id) => model(id));

/** Answers the list endpoint with the body, and records the queries it saw. */
const serve = (body: object, times = 1) => {
  const seen: Record<string, string>[] = [];
  nock('https://openrouter.ai')
    .get('/api/v1/models')
    .query((query) => {
      seen.push(query as Record<string, string>);
      return true;
    })
    .times(times)
    .reply(200, body);
  return seen;
};

const newContext = (): ToolContext => ({
  client,
  timeoutMs: 60_000,
  catalog: createCatalogCache(),
});

const call = (args: object, context = newContext()) =>
  callTool(
    TOOLS,
    'search_models',
    JSON.stringify({ category: 'programming', ...args }),
    context,
  );

const pageOf = async (args: object, context?: ToolContext) => {
  const result = await call(args, context);
  if (!result.ok) throw new Error(result.message);
  const page = JSON.parse(JSON.stringify(result.value)) as {
    total: number;
    offset: number;
    next_offset: number | null;
    models: { id: string }[];
  };
  return { ...page, models: page.models.map((entry) => entry.id) };
};

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('search_models with a category', () => {
  it('keeps the models that list every required parameter, in the order of the API', async () => {
    const seen = serve(
      list([
        model('a/x', ['tools', 'seed']),
        model('b/y', ['seed']),
        model('c/z', ['seed', 'tools', 'reasoning']),
      ]),
    );
    expect(
      await pageOf({ supported_parameters: ['tools', 'seed'] }),
    ).toMatchObject({ total: 2, models: ['a/x', 'c/z'] });
    expect(seen).toEqual([{ category: 'programming' }]);
  });

  it('sends every other filter as before', async () => {
    const seen = serve(list([]));
    await pageOf({ query: 'x', min_context_length: 5, max_prompt_price: 2 });
    expect(seen).toEqual([
      { category: 'programming', q: 'x', context: '5', max_price: '2' },
    ]);
  });

  it.each([
    [{ limit: 2, offset: 2 }, ['a/3', 'a/4'], 4],
    [{ limit: 2, offset: 4 }, ['a/5'], null],
    [{ offset: 9 }, [], null],
    [{}, ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'], null],
  ])('cuts the page %j itself', async (args, models, next) => {
    serve(list(FIVE));
    expect(await pageOf(args)).toEqual({
      total: 5,
      offset: (args as { offset?: number }).offset ?? 0,
      next_offset: next,
      models,
    });
  });

  it('ranks and drops free models by price before the page, and reads the list once', async () => {
    const seen = serve(
      list([
        model('a/dear', ['tools'], '0.000003'),
        model('b/free', ['tools'], '0'),
        model('c/cheap', ['tools'], '0.000001'),
        model('d/none', [], '0.0000001'),
      ]),
    );
    const context = newContext();
    const args = {
      sort: 'input-price-low-to-high',
      paid_only: true,
      supported_parameters: ['tools'],
      limit: 1,
    };
    expect(await pageOf(args, context)).toMatchObject({
      total: 2,
      next_offset: 1,
      models: ['c/cheap'],
    });
    expect(await pageOf({ ...args, offset: 1 }, context)).toMatchObject({
      models: ['a/dear'],
    });
    // Other parameters narrow the same list, so they need no new read.
    expect(
      await pageOf({ sort: 'input-price-low-to-high' }, context),
    ).toMatchObject({ total: 4 });
    expect(seen).toEqual([{ category: 'programming' }]);
  });

  it.each([[undefined], ['input-price-low-to-high']])(
    'refuses a list that offers a next page, with the sort %s, and asks no more',
    async (sort) => {
      const seen = serve(list(FIVE, '/api/v1/models?offset=5'), 2);
      expect(await call({ sort })).toEqual({
        ok: false,
        message:
          'The API did not give the whole list of this category, and its next page cannot be requested. Search again without category.',
      });
      expect(seen).toHaveLength(1);
    },
  );

  it('gives the failure of the API as the result', async () => {
    nock('https://openrouter.ai')
      .get('/api/v1/models')
      .query(true)
      .reply(400, { error: { code: 400, message: 'no such thing' } });
    expect(await call({})).toEqual({
      ok: false,
      message: 'API error 400: no such thing',
    });
  });

  it('pages through exactly the models that list every required parameter, no page above the limit', async () => {
    const parameters = fc.subarray(['tools', 'seed', 'reasoning']);
    await fc.assert(
      fc.asyncProperty(
        fc.array(parameters, { maxLength: 12 }),
        parameters.filter((required) => required.length > 0),
        fc.integer({ min: 1, max: 5 }),
        async (listed, required, limit) => {
          const models = listed.map((names, i) => model(`m/${i}`, names));
          const kept = models
            .filter((m) =>
              required.every((name) => m.supported_parameters.includes(name)),
            )
            .map((m) => m.id);
          const seen: string[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            serve(list(models));
            const page: Awaited<ReturnType<typeof pageOf>> = await pageOf({
              supported_parameters: required,
              limit,
              offset,
            });
            expect(page.total).toBe(kept.length);
            expect(page.models.length).toBeLessThanOrEqual(limit);
            seen.push(...page.models);
            offset = page.next_offset;
          }
          expect(seen).toEqual(kept);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('says in the description of category that the list is short and may miss the best of the catalog', () => {
    const tools = functionTools(TOOLS) as unknown as {
      function: {
        name: string;
        parameters: { properties: { category: { description: string } } };
      };
    }[];
    const search = tools.find((t) => t.function.name === 'search_models');
    expect(search?.function.parameters.properties.category.description).toBe(
      'The use case the models are used for. The API answers with a short list it picks for that use, so the cheapest or best model of that list may not be the cheapest or best of the catalog.',
    );
  });
});
