import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { run } from '../src/cli.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  recordedModelsList,
  sseBody,
  toolRound,
  usageChunk,
} from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const env = {
  OPENROUTER_API_KEY: 'sk-or-v1-marker',
  OPENROUTER_MODEL: 'env/model',
};
let api: FakeApi;
let emptyDir: string;

const cli = async (argv: string[]) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(argv, env, {
    serverURL: api.url,
    cwd: emptyDir,
    stdin: { isTTY: true, read: async () => '' },
    stdout: {
      write: (text: string) => {
        out.stdout += text;
      },
    },
    stderr: {
      write: (text: string) => {
        out.stderr += text;
      },
    },
  });
  return { code, ...out };
};

const SEARCH = {
  sort: 'newest',
  supported_parameters: ['tools'],
  limit: 2,
};

beforeAll(async () => {
  api = await startFakeApi();
  emptyDir = await mkdtemp(join(tmpdir(), 'search-cwd-'));
});
afterAll(async () => {
  await api.close();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

describe('a question that needs a search', () => {
  const ask = async () => {
    api.reply(
      200,
      toolRound([
        { id: 'c1', name: 'search_models', arguments: JSON.stringify(SEARCH) },
      ]),
    );
    api.replyGet('/models', 200, recordedModelsList);
    api.reply(
      200,
      sseBody(contentChunk('The cheapest is free.'), usageChunk()),
    );
    return cli(['-q', 'Cheapest models that can call tools?', '--verbose']);
  };

  it('searches the catalog with the filters the model chose and answers from the result', async () => {
    const result = await ask();
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('The cheapest is free.\n');
    const [get] = api.sent.filter((sent) => sent.method === 'GET');
    expect(get?.path).toBe('/api/v1/models');
    expect(Object.fromEntries(get?.query ?? [])).toMatchObject({
      sort: 'newest',
      supported_parameters: 'tools',
      limit: '2',
    });
    expect(result.stderr).toContain(
      `tool: search_models ${JSON.stringify(SEARCH)}`,
    );
  });

  it('offers search_models to the model', async () => {
    await ask();
    const [first] = api.sent.filter((sent) => sent.method === 'POST');
    expect(first?.body.tools?.map((tool) => tool.function.name)).toContain(
      'search_models',
    );
  });

  it('sends back a compact page: totals, a next offset and models without descriptions, priced per million', async () => {
    await ask();
    const [, second] = api.sent.filter((sent) => sent.method === 'POST');
    const message = second?.body.messages?.find((m) => m.role === 'tool');
    const page = JSON.parse(String(message?.content));
    expect(page).toMatchObject({ total: 375, offset: 0, next_offset: 2 });
    expect(page.models).toHaveLength(2);
    expect(page.models[0]).toEqual({
      id: 'cohere/north-mini-code:free',
      name: 'Cohere: North Mini Code (free)',
      context_length: 256000,
      max_completion_tokens: 64000,
      prompt_price: 0,
      completion_price: 0,
      input_modalities: ['text'],
      output_modalities: ['text'],
      supports_reasoning: true,
      intelligence_index: 9.9,
      created: '2026-06-17',
    });
    expect(page.models[1].intelligence_index).toBeNull();
    expect(JSON.stringify(page)).not.toContain('description');
  });
});

describe('a question about the cheapest input price', () => {
  const perToken = (perMillion: number) => (perMillion / 1e6).toFixed(12);
  const priced = (id: string, input: number, output: number) => ({
    ...(recordedModelsList.data[0] as Record<string, unknown>),
    id,
    name: id,
    pricing: { prompt: perToken(input), completion: perToken(output) },
  });
  // The API orders by the average of both prices, so ling comes first and glm-5.2 last.
  const catalog = {
    data: [
      priced('inclusionai/ling-3.0-tiny', 0.015, 0.045),
      priced('inclusionai/ling-3.0-flash', 0.021, 0.063),
      priced('z-ai/glm-5.2', 0.007, 6.8),
    ],
    total_count: 3,
    links: { next: null },
  };
  const CHEAPEST = {
    sort: 'input-price-low-to-high',
    supported_parameters: ['tools'],
    min_context_length: 200000,
    paid_only: true,
    limit: 1,
  };

  it('sorts by the input price itself, so the model reads the cheapest model first', async () => {
    api.reply(
      200,
      toolRound([
        {
          id: 'c1',
          name: 'search_models',
          arguments: JSON.stringify(CHEAPEST),
        },
      ]),
    );
    api.replyGet('/models', 200, catalog);
    api.reply(200, sseBody(contentChunk('z-ai/glm-5.2'), usageChunk()));
    const result = await cli([
      '-q',
      'Which paid model has the lowest input price?',
    ]);
    expect(result.code).toBe(0);
    const [get] = api.sent.filter((sent) => sent.method === 'GET');
    expect(Object.fromEntries(get?.query ?? [])).toMatchObject({
      supported_parameters: 'tools',
      context: '200000',
      limit: '1000',
    });
    const [, second] = api.sent.filter((sent) => sent.method === 'POST');
    const message = second?.body.messages?.find((m) => m.role === 'tool');
    const page = JSON.parse(String(message?.content));
    expect(page.models.map((m: { id: string }) => m.id)).toEqual([
      'z-ai/glm-5.2',
    ]);
    expect(page).toMatchObject({ total: 3, next_offset: 1 });
  });

  it('fetches the catalog once for two searches of the same matches in one run', async () => {
    api.reply(
      200,
      toolRound([
        {
          id: 'c1',
          name: 'search_models',
          arguments: JSON.stringify(CHEAPEST),
        },
        {
          id: 'c2',
          name: 'search_models',
          arguments: JSON.stringify({
            ...CHEAPEST,
            sort: 'output-price-low-to-high',
          }),
        },
      ]),
    );
    api.replyGet('/models', 200, catalog);
    api.reply(200, sseBody(contentChunk('done'), usageChunk()));
    const result = await cli(['-q', 'Cheapest by input and by output?']);
    expect(result.code).toBe(0);
    expect(api.sent.filter((sent) => sent.method === 'GET')).toHaveLength(1);
  });
});
