import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { createCatalogCache } from '../src/tools/catalogCache.js';
import { DEFAULT_MIX } from '../src/tools/priceSort.js';
import { callTool, functionTools, TOOLS } from '../src/tools/registry.js';
import { SORTS, searchModels } from '../src/tools/searchModels.js';
import type { ToolContext } from '../src/tools/types.js';
import { recordedModelsList } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

type FunctionTools = {
  function: { description: string; parameters: unknown };
}[];

const HOST = 'https://openrouter.ai';
const client = createClient('sk-test-key');
const template = recordedModelsList.data[0] as Record<string, unknown>;

/** A price in USD per million tokens as the API writes it: per token, in plain decimals. */
const perToken = (perMillion: number | null): string =>
  perMillion === null ? '-1' : (perMillion / 1e6).toFixed(12);

/** A model of the API with the given prices in USD per million tokens. */
const apiModel = (
  id: string,
  input: number | null,
  output: number | null,
): Record<string, unknown> => ({
  ...template,
  id,
  name: id,
  pricing: { prompt: perToken(input), completion: perToken(output) },
});

/** A page of the API: its models, the total, and a next link when more follow. */
const apiPage = (models: Record<string, unknown>[], next: string | null) => ({
  data: models,
  total_count: models.length,
  links: { next },
});

const CATALOG = [
  apiModel('a/x', 0.015, 0.045),
  apiModel('b/y', 0.007, 6.8),
  apiModel('c/z', 0.021, 0.063),
  apiModel('f/free', 0, 0),
  apiModel('n/none', null, null),
];

const newContext = (): ToolContext => ({
  client,
  timeoutMs: 60_000,
  catalog: createCatalogCache(),
});

const call = (args: Record<string, unknown>, context: ToolContext) =>
  callTool(TOOLS, 'search_models', JSON.stringify(args), context);

const ids = (result: Awaited<ReturnType<typeof call>>): string[] => {
  if (!result.ok) throw new Error(result.message);
  const value = JSON.parse(JSON.stringify(result.value)) as {
    models: { id: string }[];
  };
  return value.models.map((model) => model.id);
};

const pageOf = (result: Awaited<ReturnType<typeof call>>) => {
  if (!result.ok) throw new Error(result.message);
  return JSON.parse(JSON.stringify(result.value)) as {
    total: number;
    offset: number;
    next_offset: number | null;
    models: { id: string }[];
  };
};

/** Answers every request to the list endpoint with the page, and records the queries it saw. */
const serve = (body: unknown, times = 1) => {
  const seen: Record<string, string>[] = [];
  nock(HOST)
    .get('/api/v1/models')
    .query((query) => {
      seen.push(query as Record<string, string>);
      return true;
    })
    .times(times)
    .reply(200, body);
  return seen;
};

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('search_models price sorts', () => {
  it('puts the lowest input price first, not the lowest average', async () => {
    serve(apiPage(CATALOG, null));
    const result = await call(
      { sort: 'input-price-low-to-high' },
      newContext(),
    );
    expect(ids(result)).toEqual(['f/free', 'b/y', 'a/x', 'c/z', 'n/none']);
  });

  it('orders by the output price, and by the blend of both with the mix the model gave', async () => {
    serve(apiPage(CATALOG, null), 2);
    const context = newContext();
    expect(
      ids(await call({ sort: 'output-price-high-to-low' }, context)),
    ).toEqual(['b/y', 'c/z', 'a/x', 'f/free', 'n/none']);
    expect(
      ids(
        await call(
          { sort: 'blended-price-low-to-high', input_per_output: 1 },
          context,
        ),
      ),
    ).toEqual(['f/free', 'a/x', 'c/z', 'b/y', 'n/none']);
  });

  it('sends the API filters and no sort, no page of 10, and asks for 1000 at a time', async () => {
    const seen = serve(apiPage(CATALOG, null));
    await call(
      {
        sort: 'input-price-low-to-high',
        supported_parameters: ['tools'],
        min_context_length: 200000,
        paid_only: true,
        limit: 3,
        offset: 1,
      },
      newContext(),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      supported_parameters: 'tools',
      context: '200000',
      limit: '1000',
      offset: '0',
    });
    expect(seen[0]).not.toHaveProperty('sort');
    expect(seen[0]).not.toHaveProperty('paid_only');
  });

  it('pages through the sorted list with limit and offset, and ends it with a null next offset', async () => {
    serve(apiPage(CATALOG, null));
    const context = newContext();
    const first = pageOf(
      await call({ sort: 'input-price-low-to-high', limit: 2 }, context),
    );
    expect(first).toMatchObject({ total: 5, offset: 0, next_offset: 2 });
    expect(first.models.map((m) => m.id)).toEqual(['f/free', 'b/y']);
    const last = pageOf(
      await call(
        { sort: 'input-price-low-to-high', limit: 2, offset: 4 },
        context,
      ),
    );
    expect(last).toMatchObject({ total: 5, offset: 4, next_offset: null });
    expect(last.models.map((m) => m.id)).toEqual(['n/none']);
  });

  it('gives an empty last page for an offset past the end', async () => {
    serve(apiPage(CATALOG, null));
    const value = pageOf(
      await call(
        { sort: 'input-price-low-to-high', offset: 100 },
        newContext(),
      ),
    );
    expect(value).toEqual({
      total: 5,
      offset: 100,
      next_offset: null,
      models: [],
    });
  });

  it('drops free and unpriced models with paid_only, and counts what remains', async () => {
    serve(apiPage(CATALOG, null));
    const value = pageOf(
      await call(
        { sort: 'input-price-low-to-high', paid_only: true },
        newContext(),
      ),
    );
    expect(value.total).toBe(3);
    expect(value.models.map((m) => m.id)).toEqual(['b/y', 'a/x', 'c/z']);
  });

  it('keeps free and unpriced models when paid_only is false', async () => {
    serve(apiPage(CATALOG, null));
    const value = pageOf(
      await call(
        { sort: 'input-price-low-to-high', paid_only: false },
        newContext(),
      ),
    );
    expect(value.total).toBe(5);
  });

  it('counts 237 of 262 matches when 17 are free and 8 have no price', async () => {
    const many = [
      ...Array.from({ length: 237 }, (_, i) =>
        apiModel(`p/${String(i).padStart(3, '0')}`, 1 + i, 2),
      ),
      ...Array.from({ length: 17 }, (_, i) => apiModel(`f/${i}`, 0, 0)),
      ...Array.from({ length: 8 }, (_, i) => apiModel(`n/${i}`, null, null)),
    ];
    serve(apiPage(many, null));
    const value = pageOf(
      await call(
        { sort: 'input-price-low-to-high', paid_only: true, limit: 50 },
        newContext(),
      ),
    );
    expect(value.total).toBe(237);
    expect(value.models.every((m) => m.id.startsWith('p/'))).toBe(true);
  });

  it('lists every model once, whatever the sort, page size and offset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'input-price-low-to-high',
          'output-price-high-to-low',
          'blended-price-low-to-high',
        ),
        fc.integer({ min: 1, max: 50 }),
        async (sort, limit) => {
          nock.cleanAll();
          serve(apiPage(CATALOG, null));
          const context = newContext();
          const seen: string[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            const page = pageOf(await call({ sort, limit, offset }, context));
            seen.push(...page.models.map((m) => m.id));
            offset = page.next_offset;
          }
          expect(seen.sort()).toEqual(
            CATALOG.map((m) => m.id as string).sort(),
          );
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('search_models blended sort', () => {
  const MIXED = [apiModel('a/x', 1, 5), apiModel('b/y', 3, 1)];

  it('weights input three to one when the model gives no mix', async () => {
    serve(apiPage(MIXED, null));
    expect(
      ids(await call({ sort: 'blended-price-low-to-high' }, newContext())),
    ).toEqual(['a/x', 'b/y']);
  });

  it('weights input and output equally for a mix of 1', async () => {
    serve(apiPage(MIXED, null));
    expect(
      ids(
        await call(
          { sort: 'blended-price-low-to-high', input_per_output: 1 },
          newContext(),
        ),
      ),
    ).toEqual(['b/y', 'a/x']);
  });
});

describe('search_models price sorts and the cache', () => {
  it('makes no second request for the next page or another sort of the same matches', async () => {
    const seen = serve(apiPage(CATALOG, null));
    const context = newContext();
    await call({ sort: 'input-price-low-to-high', limit: 2 }, context);
    await call(
      { sort: 'input-price-low-to-high', limit: 2, offset: 2 },
      context,
    );
    await call({ sort: 'output-price-low-to-high', paid_only: true }, context);
    await call(
      { sort: 'blended-price-high-to-low', input_per_output: 5 },
      context,
    );
    expect(seen).toHaveLength(1);
  });

  it('fetches again for other API filters', async () => {
    const seen = serve(apiPage(CATALOG, null), 2);
    const context = newContext();
    await call({ sort: 'input-price-low-to-high' }, context);
    await call(
      { sort: 'input-price-low-to-high', min_context_length: 100000 },
      context,
    );
    expect(seen).toHaveLength(2);
  });

  it('makes one request for calls that start together with the same filters', async () => {
    const seen = serve(apiPage(CATALOG, null));
    const context = newContext();
    await Promise.all([
      call({ sort: 'input-price-low-to-high' }, context),
      call({ sort: 'output-price-low-to-high' }, context),
    ]);
    expect(seen).toHaveLength(1);
  });

  it('follows the next link until the API has no more, with the offset it reached', async () => {
    const seen: string[] = [];
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => query.offset === '0' && !!seen.push('0'))
      .reply(200, apiPage(CATALOG.slice(0, 2), '/api/v1/models?offset=2'));
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => query.offset === '2' && !!seen.push('2'))
      .reply(200, apiPage(CATALOG.slice(2), null));
    const value = pageOf(
      await call({ sort: 'input-price-low-to-high' }, newContext()),
    );
    expect(value.total).toBe(5);
    expect(seen).toEqual(['0', '2']);
  });

  it('stops at a page with no models even when the API still links a next one', async () => {
    const seen = serve(apiPage([], '/api/v1/models?offset=0'), 5);
    const value = pageOf(
      await call({ sort: 'input-price-low-to-high' }, newContext()),
    );
    expect(value).toMatchObject({ total: 0, next_offset: null, models: [] });
    expect(seen).toHaveLength(1);
  });

  it('gives the failure of a fetch to every call that waited on it, and fetches again on the next call', async () => {
    nock(HOST)
      .get('/api/v1/models')
      .query(true)
      .reply(400, { error: { message: 'bad filter', code: 400 } });
    const context = newContext();
    const [first, second] = await Promise.all([
      call({ sort: 'input-price-low-to-high' }, context),
      call({ sort: 'output-price-low-to-high' }, context),
    ]);
    for (const result of [first, second]) {
      expect(result.ok).toBe(false);
      expect((result as { message: string }).message).toMatch(/bad filter/);
    }

    serve(apiPage(CATALOG, null));
    expect(
      ids(await call({ sort: 'input-price-low-to-high' }, context)),
    ).toHaveLength(5);
  });

  it('does not keep a fetch that failed on its second page', async () => {
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => query.offset === '0')
      .reply(200, apiPage(CATALOG.slice(0, 2), '/api/v1/models?offset=2'));
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => query.offset === '2')
      .reply(400, { error: { message: 'bad page', code: 400 } });
    const context = newContext();
    const failed = await call({ sort: 'input-price-low-to-high' }, context);
    expect(failed.ok).toBe(false);
    expect((failed as { message: string }).message).toMatch(/bad page/);

    serve(apiPage(CATALOG, null));
    expect(
      ids(await call({ sort: 'input-price-low-to-high' }, context)),
    ).toHaveLength(5);
  });

  it('asks the model to narrow the filters when the matches fill more than 5 pages, and keeps nothing', async () => {
    const seen: Record<string, string>[] = [];
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => {
        seen.push(query as Record<string, string>);
        return true;
      })
      .times(6)
      .reply(200, () => {
        const offset = seen.length - 1;
        return apiPage(
          [apiModel(`p/${offset}`, 1, 1)],
          `/api/v1/models?offset=${offset + 1}`,
        );
      });
    const context = newContext();
    const result = await call({ sort: 'input-price-low-to-high' }, context);
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/narrow the filters/i),
    });
    expect(seen).toHaveLength(5);

    nock.cleanAll();
    serve(apiPage(CATALOG, null));
    expect(
      ids(await call({ sort: 'input-price-low-to-high' }, context)),
    ).toHaveLength(5);
  });

  it('fetches one page and keeps nothing for an API sort', async () => {
    const seen = serve(recordedModelsList, 2);
    const context = newContext();
    await call({ sort: 'newest' }, context);
    await call({ sort: 'newest' }, context);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ sort: 'newest', limit: '10' });
  });

  it('still works without a cache, fetching on every call', async () => {
    const seen = serve(apiPage(CATALOG, null), 2);
    const context = { client, timeoutMs: 60_000 };
    await call({ sort: 'input-price-low-to-high' }, context);
    await call({ sort: 'input-price-low-to-high' }, context);
    expect(seen).toHaveLength(2);
  });
});

describe('search_models arguments for price sorts', () => {
  const parse = (args: unknown) => searchModels.parameters.safeParse(args);

  it.each([
    [{ sort: 'input-price-low-to-high' }, true],
    [{ sort: 'input-price-high-to-low' }, true],
    [{ sort: 'output-price-low-to-high' }, true],
    [{ sort: 'output-price-high-to-low' }, true],
    [{ sort: 'blended-price-low-to-high' }, true],
    [{ sort: 'blended-price-high-to-low' }, true],
    [{ sort: 'pricing-low-to-high' }, false],
    [{ sort: 'pricing-high-to-low' }, false],
    [{ sort: 'blended-price-low-to-high', input_per_output: 3 }, true],
    [{ sort: 'blended-price-high-to-low', input_per_output: 0.5 }, true],
    [{ sort: 'input-price-low-to-high', input_per_output: 3 }, false],
    [{ sort: 'newest', input_per_output: 3 }, false],
    [{ input_per_output: 3 }, false],
    [{ sort: 'blended-price-low-to-high', input_per_output: 0 }, false],
    [{ sort: 'blended-price-low-to-high', input_per_output: -1 }, false],
    [{ sort: 'input-price-low-to-high', paid_only: true }, true],
    [{ sort: 'blended-price-high-to-low', paid_only: true }, true],
    [{ sort: 'newest', paid_only: true }, false],
    [{ paid_only: true }, false],
    [{ paid_only: false }, true],
    [{ sort: 'newest', paid_only: false }, true],
    [{ sort: 'input-price-low-to-high', paid_only: 'yes' }, false],
  ])('%j is valid: %s', (args, valid) => {
    expect(parse(args).success).toBe(valid);
  });

  it('reads null input_per_output and paid_only as absent, with any sort', () => {
    expect(
      parse({ sort: 'newest', input_per_output: null, paid_only: null })
        .success,
    ).toBe(true);
  });
});

describe('search_models argument errors', () => {
  const messageOf = async (args: Record<string, unknown>) => {
    const result = await call(args, newContext());
    expect(result.ok).toBe(false);
    return (result as { message: string }).message;
  };

  it('tells the model which sort to use when it sends a removed one', async () => {
    const message = await messageOf({ sort: 'pricing-low-to-high' });
    expect(message).toContain('sort: "pricing-low-to-high" is not offered.');
    expect(message).toContain('"input-price-low-to-high"');
    expect(message).toContain('"output-price-low-to-high"');
    expect(message).toContain('"blended-price-low-to-high"');
    expect(message).toContain('newest');
  });

  it('gives the replacement for a removed sort, and only for a removed sort', async () => {
    expect(await messageOf({ sort: 'pricing-high-to-low' })).toContain(
      'For the lowest input price use "input-price-low-to-high", for the lowest output price "output-price-low-to-high", for a mix of both "blended-price-low-to-high"; "-high-to-low" reverses each.',
    );
    expect(await messageOf({ sort: 'best' })).not.toContain(
      'For the lowest input price',
    );
  });

  it('says exactly which values are offered for a sort it does not know', async () => {
    expect(await messageOf({ sort: 'best' })).toBe(
      `Invalid arguments. sort: "best" is not offered. The values are: ${SORTS.map((value) => `"${value}"`).join(', ')}.`,
    );
  });

  it('shows a sort that is not text as text', async () => {
    expect(await messageOf({ sort: 5 })).toContain('sort: "5" is not offered.');
  });

  it('names every offered value for a sort it has never heard of', async () => {
    const message = await messageOf({ sort: 'best' });
    expect(message).toContain('sort: "best" is not offered.');
    for (const value of ['most-popular', 'blended-price-high-to-low']) {
      expect(message).toContain(value);
    }
  });

  it('tells the model that paid_only needs a price sort, and which', async () => {
    expect(await messageOf({ paid_only: true })).toBe(
      'Invalid arguments. paid_only: needs a price sort. Set sort to one of "input-price-low-to-high", "input-price-high-to-low", "output-price-low-to-high", "output-price-high-to-low", "blended-price-low-to-high", "blended-price-high-to-low".',
    );
  });

  it('tells the model that input_per_output applies to a blended sort only', async () => {
    expect(
      await messageOf({ sort: 'input-price-low-to-high', input_per_output: 3 }),
    ).toBe(
      'Invalid arguments. input_per_output: applies to a blended sort only. Set sort to "blended-price-low-to-high" or "blended-price-high-to-low", or leave input_per_output out.',
    );
  });

  it('tells the model what a mix is when it sends 0', async () => {
    expect(
      await messageOf({
        sort: 'blended-price-low-to-high',
        input_per_output: 0,
      }),
    ).toBe(
      'Invalid arguments. input_per_output: must be above 0, the input tokens for each output token, such as 3.',
    );
  });
});

describe('search_models schema offered to the model', () => {
  const schema = (() => {
    const [tool] = functionTools([searchModels]) as FunctionTools;
    return tool?.function.parameters as {
      properties: Record<string, { description?: string; enum?: string[] }>;
    };
  })();
  const description = (name: string): string =>
    schema.properties[name]?.description ?? '';

  it('describes every argument', () => {
    for (const name of Object.keys(searchModels.parameters.shape)) {
      expect(description(name).length, name).toBeGreaterThan(20);
    }
  });

  it('names every value of the sort enum in its description', () => {
    for (const value of SORTS) {
      expect(description('sort'), value).toContain(value);
    }
  });

  it('says in the sort description who applies each kind of order, and where models without a price or score go', () => {
    const text = description('sort');
    expect(text).toMatch(/API applies/);
    expect(text).toMatch(/tool applies/);
    expect(text).toMatch(/no price comes last/);
    expect(text).toMatch(/without a score come last/);
    expect(text).toMatch(/price 0/);
    expect(text).toMatch(/limit to 1/);
  });

  it('names the blended sorts as the choice when the user gives no usage, and the default mix', () => {
    const text = description('sort');
    expect(text).toMatch(
      /states no usage, use blended-price-low-to-high or blended-price-high-to-low/,
    );
    expect(text).toContain(`the default mix is ${DEFAULT_MIX}`);
  });

  it('names the sorts that input_per_output and paid_only need, and what happens otherwise', () => {
    expect(description('input_per_output')).toMatch(/blended-price-/);
    expect(description('input_per_output')).toMatch(/fails/);
    expect(description('paid_only')).toMatch(
      /input-, output- or blended-price/,
    );
    expect(description('paid_only')).toMatch(/fails/);
  });

  it.each([
    [
      'min_prompt_price',
      /input price.*at least.*USD per million tokens.*included/s,
    ],
    [
      'max_prompt_price',
      /input price.*at most.*USD per million tokens.*included/s,
    ],
    [
      'min_completion_price',
      /output price.*at least.*USD per million tokens.*included/s,
    ],
    [
      'max_completion_price',
      /output price.*at most.*USD per million tokens.*included/s,
    ],
  ])(
    'says whose price %s bounds, in what unit, and that the bound is included',
    (name, pattern) => {
      expect(description(name)).toMatch(pattern);
      expect(description(name)).toMatch(/free model has price 0/);
    },
  );

  it('gives the range, the default and the way on for limit and offset', () => {
    expect(description('limit')).toMatch(/1 to 50.*default is 10/);
    expect(description('offset')).toMatch(/default is 0.*next_offset/);
  });

  it('says in the tool description that the tool applies price sorts and paid_only over every match', () => {
    const [tool] = functionTools([searchModels]) as FunctionTools;
    expect(tool?.function.description).toMatch(
      /Price sorts and paid_only are applied by this tool over every match/,
    );
  });
});
