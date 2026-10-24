import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
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
  recordedModel,
  sseBody,
  toolRound,
  usageChunk,
} from './fixtures.js';
import { sink } from './sink.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));
// How the SDK fails: not at all, at the start of every observation, or on every update and end of the ones it gave.
const sdk = vi.hoisted(() => ({
  mode: 'start' as 'start' | 'update',
}));
vi.mock('@langfuse/tracing', async (original) => {
  const real = await original<typeof import('@langfuse/tracing')>();
  const broken = (): never => {
    throw new Error('the SDK is broken');
  };
  const handle: Record<string, unknown> = {
    update: broken,
    end: broken,
  };
  handle.startObservation = () => handle;
  return {
    ...real,
    startObservation: () => (sdk.mode === 'start' ? broken() : handle),
  };
});

let api: FakeApi;
let dir: string;
beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-fault-'));
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

const tracedRun = async () => {
  const out = { stdout: '', stderr: '' };
  const code = await run(
    ['-q', 'hi'],
    {
      OPENROUTER_API_KEY: 'sk-or-x',
      OPENROUTER_MODEL: 'm',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_BASE_URL: api.url.replace(/\/api\/v1$/, ''),
    },
    {
      serverURL: api.url,
      tracing: { exporter: new InMemorySpanExporter() },
      cwd: dir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: sink(out, 'stdout'),
      stderr: sink(out, 'stderr'),
    },
  );
  return { code, ...out };
};

describe.each([
  ['at the start of every observation', 'start'],
  ['on every update and end', 'update'],
] as const)('a tracing SDK that fails %s', (_name, mode) => {
  beforeEach(() => {
    sdk.mode = mode;
  });

  it('leaves the answer, the tool calls and the exit code as they would be untraced', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    api.reply(
      200,
      toolRound([{ id: 'c1', name: 'get_model', arguments: '{"slug":"a/b"}' }]),
    );
    api.replyGet('/model/a/b', 200, {
      data: { ...recordedModel.data, id: 'a/b' },
    });
    api.reply(
      200,
      sseBody(
        contentChunk('Fine.'),
        usageChunk({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      ),
    );
    const result = await tracedRun();
    expect(result.stdout).toBe('Fine.\n');
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/broken/);
  });
});
