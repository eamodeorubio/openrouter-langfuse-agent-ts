import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { currentBenchmarks } from '../src/tools/benchmarks.js';
import { createCatalogCache } from '../src/tools/catalogCache.js';
import { callTool, functionTools, TOOLS } from '../src/tools/registry.js';
import { recordedModel, recordedModelsList } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const client = createClient('sk-test-key');

/** The table of the spec: each index, what it measures and its scale. */
const INDEXES = [
  ['intelligence', 'general intelligence', '0 to 100'],
  ['finance_and_accounting', 'finance and accounting work', '0 to 100'],
  ['strategy_and_ops', 'strategy and operations work', '0 to 100'],
  ['legal', 'legal work', '0 to 100'],
  ['healthcare_and_medical', 'healthcare and medical work', '0 to 100'],
  ['engineering', 'engineering work', '0 to 100'],
  ['economics', 'economics work', '0 to 100'],
  ['cyber', 'cybersecurity work', '0 to 100'],
  ['openness', 'how open the model is', '0 to 100'],
  ['multilingual', 'skill across languages', '0 to 1'],
  ['decision', 'decision tasks', '0 to 100'],
] as const;

const NEW_SORTED = INDEXES.map(([name]) => name).filter(
  (name) => name !== 'intelligence' && name !== 'decision',
);
const sortOf = (name: string) => `${name.replaceAll('_', '-')}-high-to-low`;
const camel = (name: string) =>
  `${name}_index`.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const context = () => ({
  client,
  timeoutMs: 60_000,
  catalog: createCatalogCache(),
});

const scored = (scores: Record<string, number | null>) => {
  const model = recordedModelsList.data[0] as Record<string, unknown>;
  const benchmarks = model.benchmarks as { artificial_analysis: object };
  return {
    ...model,
    supported_parameters: ['tools'],
    benchmarks: {
      design_arena: [],
      artificial_analysis: { ...benchmarks.artificial_analysis, ...scores },
    },
  };
};

const search = async (args: object, models: object[]) => {
  const seen: Record<string, string>[] = [];
  nock(HOST)
    .get('/api/v1/models')
    .query((query) => {
      seen.push(query as Record<string, string>);
      return true;
    })
    .reply(200, {
      data: models,
      total_count: models.length,
      links: { next: null },
    });
  const result = await callTool(
    TOOLS,
    'search_models',
    JSON.stringify(args),
    context(),
  );
  if (!result.ok) throw new Error(result.message);
  const page = JSON.parse(JSON.stringify(result.value)) as {
    models: Record<string, unknown>[];
  };
  return { seen, entries: page.models };
};

/** The index fields of a search entry. */
const indexFields = (entry: Record<string, unknown> | undefined) =>
  Object.keys(entry ?? {}).filter((key) => key.endsWith('_index'));

interface Described {
  function: {
    name: string;
    description: string;
    parameters: { properties: Record<string, { description: string }> };
  };
}
const described = (name: string) => {
  const tools = functionTools(TOOLS) as unknown as Described[];
  const tool = tools.find((t) => t.function.name === name);
  if (!tool) throw new Error(name);
  return tool.function;
};

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('the benchmark indexes as get_model describes them', () => {
  it.each(INDEXES)(
    'says that %s_index measures %s, from %s',
    (name, ...rest) => {
      const [measures, scale] = rest;
      expect(described('get_model').description).toContain(
        `${name}_index (${measures}, ${scale})`,
      );
    },
  );

  it.each([
    'Higher is better.',
    'A missing or null score means the model is unscored, never zero.',
    'Each score is the best across the configurations tested, so two indexes of one model may come from different configurations.',
    'Name Artificial Analysis when you quote a score.',
  ])('says: %s', (sentence) => {
    expect(described('get_model').description).toContain(sentence);
  });
});

describe('the benchmark indexes as the sort of search_models describes them', () => {
  const sort = () =>
    described('search_models').parameters.properties.sort?.description ?? '';

  it.each([...NEW_SORTED, 'intelligence'])(
    'offers the sort by %s, which the naming rule ties to its index',
    (name) => {
      expect(sort()).toContain(sortOf(name));
    },
  );

  it.each([
    'Each ranks by the index of the same name, with underscores for hyphens, such as legal-high-to-low by legal_index.',
    'The description of get_model says what each index measures.',
    'multilingual_index runs from 0 to 1, the others from 0 to 100, and higher is better.',
    'Models without a score come last: they are unscored, never zero.',
    'No index measures coding alone.',
    'Name Artificial Analysis when you quote a score.',
  ])('says: %s', (sentence) => {
    expect(sort()).toContain(sentence);
  });

  it('offers no sort by the decision index', () => {
    expect(sort()).not.toContain('decision');
  });
});

describe('search_models sorted by an index', () => {
  it.each(NEW_SORTED)(
    'sends the sort by %s, and shows that score beside the intelligence index',
    async (name) => {
      const { seen, entries } = await search({ sort: sortOf(name) }, [
        scored({ [`${name}_index`]: 0.5 }),
        scored({ [`${name}_index`]: 0 }),
        scored({ [`${name}_index`]: null }),
      ]);
      expect(seen[0]?.sort).toBe(sortOf(name));
      expect(indexFields(entries[0])).toEqual([
        'intelligence_index',
        `${name}_index`,
      ]);
      expect(entries.map((entry) => entry[`${name}_index`])).toEqual([
        0.5,
        0,
        null,
      ]);
    },
  );

  it('shows the score in a search by category too', async () => {
    const { entries } = await search(
      { category: 'legal', sort: 'legal-high-to-low' },
      [scored({ legal_index: 41.2 })],
    );
    expect(entries[0]?.legal_index).toBe(41.2);
  });

  it('gives null for the score of a model with no benchmarks', async () => {
    const { benchmarks: _, ...plain } = scored({});
    const { entries } = await search({ sort: 'legal-high-to-low' }, [plain]);
    expect(entries[0]?.legal_index).toBeNull();
  });

  it.each([
    [undefined],
    ['newest'],
    ['intelligence-high-to-low'],
    ['input-price-low-to-high'],
  ])('shows the intelligence index alone with the sort %s', async (sort) => {
    const { entries } = await search({ sort }, [scored({ legal_index: 1 })]);
    expect(indexFields(entries[0])).toEqual(['intelligence_index']);
  });

  it('refuses a sort by the decision index', async () => {
    const result = await callTool(
      TOOLS,
      'search_models',
      JSON.stringify({ sort: 'decision-high-to-low' }),
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        '"decision-high-to-low" is not offered.',
      ),
    });
  });
});

describe('get_model and unscored indexes', () => {
  const benchmarksFor = async (artificialAnalysis: object) => {
    nock(HOST)
      .get('/api/v1/model/openai/gpt-oss-20b')
      .reply(200, {
        data: {
          ...(recordedModel.data as object),
          benchmarks: {
            design_arena: [],
            artificial_analysis: artificialAnalysis,
          },
        },
      });
    const result = await callTool(
      TOOLS,
      'get_model',
      '{"slug":"openai/gpt-oss-20b"}',
      context(),
    );
    if (!result.ok) throw new Error(result.message);
    return JSON.parse(JSON.stringify(result.value)).benchmarks;
  };
  const allNull = Object.fromEntries(
    [
      ...INDEXES.map(([name]) => `${name}_index`),
      'coding_index',
      'agentic_index',
    ].map((key) => [key, null]),
  );

  it('keeps the indexes that have a score, 0 included, and no other', async () => {
    expect(
      await benchmarksFor({ ...allNull, legal_index: 41.2, cyber_index: 0 }),
    ).toStrictEqual({
      design_arena: [],
      artificial_analysis: { legal_index: 41.2, cyber_index: 0 },
    });
  });

  it('leaves artificial_analysis out when no index has a score', async () => {
    expect(await benchmarksFor(allNull)).toStrictEqual({ design_arena: [] });
  });

  it('keeps exactly the scored indexes that are not retired, whatever the scores', () => {
    const keys = [
      ...INDEXES.map(([name]) => camel(name)),
      'codingIndex',
      'agenticIndex',
    ];
    const scores = fc.dictionary(
      fc.constantFrom(...keys),
      fc.option(fc.double({ noNaN: true }), { nil: null }),
    );
    fc.assert(
      fc.property(scores, (artificialAnalysis) => {
        const kept = Object.entries(artificialAnalysis).filter(
          ([key, value]) =>
            value !== null && key !== 'codingIndex' && key !== 'agenticIndex',
        );
        expect(currentBenchmarks({ artificialAnalysis })).toStrictEqual(
          kept.length > 0
            ? { artificialAnalysis: Object.fromEntries(kept) }
            : {},
        );
      }),
    );
  });
});
