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
  recordedModel,
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

const toolMessages = () =>
  api.sent
    .filter((sent) => sent.method === 'POST')
    .flatMap((sent) => sent.body.messages ?? [])
    .filter((message) => message.role === 'tool')
    .map((message) => String(message.content));

const calc = (id: string, expression: string) => ({
  id,
  name: 'calculate',
  arguments: JSON.stringify({ expression }),
});

beforeAll(async () => {
  api = await startFakeApi();
  emptyDir = await mkdtemp(join(tmpdir(), 'calc-cwd-'));
});
afterAll(async () => {
  await api.close();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

describe('a question about the cost of a workload', () => {
  it('reads the prices, computes the total with calculate, and answers from the tool results', async () => {
    api.reply(
      200,
      toolRound([
        {
          id: 'c1',
          name: 'get_model',
          arguments: '{"slug":"openai/gpt-oss-20b"}',
        },
      ]),
    );
    api.replyGet('/model/openai/gpt-oss-20b', 200, recordedModel);
    api.reply(200, toolRound([calc('c2', '5 * 0.018 + 1 * 0.09')]));
    api.reply(200, sseBody(contentChunk('It costs $0.18.'), usageChunk()));
    const result = await cli([
      '-q',
      '5M input and 1M output tokens on gpt-oss-20b?',
      '--verbose',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('It costs $0.18.\n');
    expect(result.stderr).toContain(
      'tool: calculate {"expression":"5 * 0.018 + 1 * 0.09"}',
    );
    const messages = toolMessages();
    expect(JSON.parse(messages.at(-1) ?? '')).toEqual({
      formula: '5 * 0.018 + 1 * 0.09 = 0.18',
      result: 0.18,
    });
  });

  it('offers calculate to the model next to the catalog tools', async () => {
    api.reply(200, sseBody(contentChunk('ok'), usageChunk()));
    await cli(['-q', 'q']);
    const [sent] = api.sent;
    expect(sent?.body.tools?.map((tool) => tool.function.name)).toEqual([
      'get_model',
      'search_models',
      'calculate',
    ]);
  });
});

describe('an expression that cannot be computed', () => {
  it.each([
    ['10 / (5 - 5)', /Division by zero/],
    ['process.exit(1)', /Unexpected character "p" at position 1/],
  ])(
    'reaches the model as an error result, and the run still answers: %s',
    async (expression, pattern) => {
      api.reply(200, toolRound([calc('c1', expression)]));
      api.reply(
        200,
        sseBody(contentChunk('I could not compute that.'), usageChunk()),
      );
      const result = await cli(['-q', 'q']);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('I could not compute that.\n');
      expect(JSON.parse(toolMessages()[0] ?? '').error).toMatch(pattern);
    },
  );
});
