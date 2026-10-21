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
  RECORDED_TOOL_ROUND,
  recordedModel,
  recordedToolStream,
  sseBody,
  toolRound,
  usageChunk,
} from './fixtures.js';

// Retries wait between attempts; tests must not.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const KEY = 'sk-or-v1-marker-do-not-print';
const env = { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'env/model' };

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

/** The models the recorded tool round asks for, answered with the recorded model under their slugs. */
const queueTools = () => {
  for (const call of RECORDED_TOOL_ROUND.calls) {
    const slug = (JSON.parse(call.arguments) as { slug: string }).slug;
    api.replyGet(`/model/${slug}`, 200, {
      data: { ...recordedModel.data, id: slug },
    });
  }
};

const ROUND_2_USAGE = {
  prompt_tokens: 700,
  completion_tokens: 50,
  total_tokens: 750,
};

/** Round 1: the recorded tool calls. Round 2: a plain answer. */
const queueTwoRounds = () => {
  api.reply(200, recordedToolStream);
  queueTools();
  api.reply(
    200,
    sseBody(contentChunk('Both are cheap.'), usageChunk(ROUND_2_USAGE)),
  );
};

beforeAll(async () => {
  api = await startFakeApi();
  emptyDir = await mkdtemp(join(tmpdir(), 'agent-cwd-'));
});
afterAll(async () => {
  await api.close();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

describe('a question that needs tools', () => {
  it('answers after one round of two parallel get_model calls', async () => {
    queueTwoRounds();
    const result = await cli(['-q', 'Compare the two gpt-oss models.']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Both are cheap.\n');
    const chat = api.sent.filter((sent) => sent.method === 'POST');
    expect(chat).toHaveLength(2);
    expect(
      api.sent.filter((sent) => sent.method === 'GET').map((s) => s.path),
    ).toEqual(
      expect.arrayContaining(
        RECORDED_TOOL_ROUND.calls.map(
          (call) =>
            `/api/v1/model/${(JSON.parse(call.arguments) as { slug: string }).slug}`,
        ),
      ),
    );
  });

  it('opens every request with the system message and offers get_model with parallel calls', async () => {
    queueTwoRounds();
    await cli(['-q', 'Compare the two gpt-oss models.']);
    for (const { body } of api.sent.filter((s) => s.method === 'POST')) {
      expect(body.messages?.[0]?.role).toBe('system');
      expect(body.messages?.[1]).toEqual({
        role: 'user',
        content: 'Compare the two gpt-oss models.',
      });
      expect(body.tools?.map((tool) => tool.function.name)).toContain(
        'get_model',
      );
      expect(body.parallel_tool_calls).toBe(true);
    }
  });

  it('sends round 2 the assistant turn as received and one tool result per call, in call order', async () => {
    queueTwoRounds();
    await cli(['-q', 'Compare the two gpt-oss models.']);
    const [, second] = api.sent.filter((s) => s.method === 'POST');
    const messages = second?.body.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
    ]);
    const assistant = messages[2] as {
      tool_calls: { id: string; type: string; function: object }[];
      reasoning_details: object[];
    };
    expect(assistant.tool_calls).toEqual(
      RECORDED_TOOL_ROUND.calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    );
    expect(assistant.reasoning_details).toEqual([
      expect.objectContaining({
        type: 'reasoning.text',
        text: RECORDED_TOOL_ROUND.reasoningText,
        signature: RECORDED_TOOL_ROUND.signature,
      }),
    ]);
    expect(messages.slice(3).map((message) => message.tool_call_id)).toEqual(
      RECORDED_TOOL_ROUND.calls.map((call) => call.id),
    );
  });

  it('sums the tokens of both rounds in the status line', async () => {
    queueTwoRounds();
    const result = await cli(['-q', 'Compare the two gpt-oss models.']);
    const first = RECORDED_TOOL_ROUND.usage;
    expect(result.stderr).toContain(
      `tokens: ${(first?.prompt_tokens ?? 0) + ROUND_2_USAGE.prompt_tokens} prompt, `,
    );
    expect(result.stderr).toContain(
      `${(first?.total_tokens ?? 0) + ROUND_2_USAGE.total_tokens} total`,
    );
  });

  it('writes no tool lines without --verbose', async () => {
    queueTwoRounds();
    const result = await cli(['-q', 'Compare the two gpt-oss models.']);
    expect(result.stderr).not.toMatch(/^tool:/m);
  });

  it('writes one tool line per call with --verbose, none on stdout', async () => {
    queueTwoRounds();
    const result = await cli([
      '-q',
      'Compare the two gpt-oss models.',
      '--verbose',
    ]);
    const toolLines = result.stderr
      .split('\n')
      .filter((l) => l.startsWith('tool:'));
    expect(toolLines).toEqual(
      RECORDED_TOOL_ROUND.calls.map(
        (call) => `tool: ${call.name} ${call.arguments}`,
      ),
    );
    expect(result.stdout).not.toContain('tool:');
  });
});

describe('limits and usage', () => {
  it('exits 3 with a one-line message when the model keeps calling tools, keeping what it wrote', async () => {
    for (let i = 0; i < 9; i++) {
      api.reply(
        200,
        toolRound(
          [{ id: `c${i}`, name: 'get_model', arguments: '{"slug":"a/b"}' }],
          { text: i === 0 ? 'Looking.' : '' },
        ),
      );
    }
    for (let i = 0; i < 8; i++) {
      api.replyGet('/model/a/b', 200, recordedModel);
    }
    const result = await cli(['-q', 'q']);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe('Looking.\n');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/kept calling tools/i);
  });

  it('lists --verbose in the usage message', async () => {
    const result = await cli(['--nope']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--verbose');
  });
});
