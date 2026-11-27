import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  recordedModelsList,
  sseBody,
  toolRound,
  usageChunk,
} from './fixtures.js';

const SEARCH = {
  category: 'programming',
  supported_parameters: ['tools'],
  sort: 'newest',
  limit: 1,
  offset: 1,
};

const template = recordedModelsList.data[0] as Record<string, unknown>;
const model = (id: string, parameters: string[]) => ({
  ...template,
  id,
  supported_parameters: parameters,
});
const CATEGORY_LIST = {
  data: [
    model('a/x', ['tools', 'seed']),
    model('b/y', ['seed']),
    model('c/z', ['tools']),
  ],
  total_count: 3,
  links: { next: null },
};

describe('a question that needs a search by category', () => {
  let api: FakeApi;
  let emptyDir: string;

  beforeAll(async () => {
    api = await startFakeApi();
    emptyDir = await mkdtemp(join(tmpdir(), 'category-cwd-'));
  });
  afterAll(async () => {
    await api.close();
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('asks the API only for what it accepts beside a category, and filters and pages the list itself', async () => {
    api.reply(
      200,
      toolRound([
        { id: 'c1', name: 'search_models', arguments: JSON.stringify(SEARCH) },
      ]),
    );
    api.replyGet('/models', 200, CATEGORY_LIST);
    api.reply(200, sseBody(contentChunk('c/z'), usageChunk()));
    const nothing = { write: () => {} };

    const code = await run(
      ['-q', 'The second newest coding model with tools?'],
      { OPENROUTER_API_KEY: 'sk-or-v1-marker', OPENROUTER_MODEL: 'env/model' },
      {
        serverURL: api.url,
        cwd: emptyDir,
        stdin: { isTTY: true, read: async () => '' },
        stdout: nothing,
        stderr: nothing,
      },
    );

    expect(code).toBe(0);
    const [get] = api.sent.filter((sent) => sent.method === 'GET');
    expect([...(get?.query ?? [])].sort()).toEqual([
      ['category', 'programming'],
      ['sort', 'newest'],
    ]);
    const [, second] = api.sent.filter((sent) => sent.method === 'POST');
    const result = second?.body.messages?.find((m) => m.role === 'tool');
    expect(JSON.parse(String(result?.content))).toMatchObject({
      total: 2,
      offset: 1,
      next_offset: null,
      models: [{ id: 'c/z' }],
    });
  });
});
