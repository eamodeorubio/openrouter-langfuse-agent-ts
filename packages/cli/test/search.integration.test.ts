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
  sort: 'pricing-low-to-high',
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
      sort: 'pricing-low-to-high',
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
      coding_index: 36.5,
      agentic_index: 1.1,
      created: '2026-06-17',
    });
    expect(page.models[1].intelligence_index).toBeNull();
    expect(JSON.stringify(page)).not.toContain('description');
  });
});
