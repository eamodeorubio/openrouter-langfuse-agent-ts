import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
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
  errorChunk,
  RECORDED_401_MESSAGE,
  recordedUnauthorized,
  sseBody,
  thinkingChunk,
  toolRound,
  usageChunk,
} from './fixtures.js';
import { matchesPublishedSchema } from './schema.js';
import { sink } from './sink.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const KEY = 'sk-or-v1-marker-do-not-print';
const PK = 'pk-lf-marker';
const SK = 'sk-lf-marker';
const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

let api: FakeApi;
let dir: string;

const origin = () => api.url.replace(/\/api\/v1$/, '');
const langfuse = () => ({
  LANGFUSE_PUBLIC_KEY: PK,
  LANGFUSE_SECRET_KEY: SK,
  LANGFUSE_BASE_URL: origin(),
});

const start = (
  argv: string[],
  env: Record<string, string> = {},
  exporter?: SpanExporter,
) => {
  const out = { stdout: '', stderr: '' };
  const done = run(
    argv,
    { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm', ...env },
    {
      serverURL: api.url,
      tracing: exporter ? { exporter } : undefined,
      cwd: dir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: sink(out, 'stdout'),
      stderr: sink(out, 'stderr'),
    },
  );
  return { out, done };
};

const cli = async (
  argv: string[],
  env: Record<string, string> = {},
  exporter?: SpanExporter,
) => {
  const { out, done } = start(argv, env, exporter);
  const code = await done;
  return { code, ...out };
};

const answer = (
  text: string,
  thinking: string[] = [],
  usage: Record<string, unknown> = USAGE,
  model = 'test/model',
) =>
  api.reply(
    200,
    sseBody(
      ...[
        ...thinking.map(thinkingChunk),
        contentChunk(text),
        usageChunk(usage),
      ].map((chunk) => ({ ...chunk, model })),
    ),
  );

const calculate = (usage: Record<string, unknown>) =>
  api.reply(
    200,
    toolRound(
      [{ id: 'c1', name: 'calculate', arguments: '{"expression":"1+1"}' }],
      { usage },
    ),
  );

const parse = (text: string): Record<string, unknown> => {
  expect(text.endsWith('\n')).toBe(true);
  expect(text.trimEnd()).not.toContain('\n');
  const object = JSON.parse(text);
  expect(
    matchesPublishedSchema(object),
    JSON.stringify(matchesPublishedSchema.errors),
  ).toBe(true);
  return object;
};

beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-json-'));
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

describe('--json on success', () => {
  it('writes the object to stdout, and nothing to stderr', async () => {
    answer('4');
    const result = await cli(['-q', '2+2', '--json']);
    expect(parse(result.stdout)).toEqual({
      question: '2+2',
      answer: '4',
      success: true,
      model: 'test/model',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('holds the thinking and the trace id when there are any', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    answer('4', ['Add.']);
    const exporter = new InMemorySpanExporter();
    const result = await cli(['-q', '2+2', '--json'], langfuse(), exporter);
    const traceId = exporter.getFinishedSpans()[0]?.spanContext().traceId;
    expect(traceId).toBeTruthy();
    expect(parse(result.stdout)).toEqual({
      question: '2+2',
      answer: '4',
      success: true,
      model: 'test/model',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      thinking: 'Add.',
      traceId,
    });
    expect(result.stderr).toBe('');
  });

  it.each([['--no-thinking'], ['--thinking']])(
    'holds the thinking whatever %s says',
    async (flag) => {
      answer('4', ['Add.']);
      const result = await cli(['-q', '2+2', '--json', flag]);
      expect(parse(result.stdout).thinking).toBe('Add.');
      expect(result.stderr).toBe('');
    },
  );

  it('joins the text of several rounds as the answer would show it', async () => {
    api.reply(
      200,
      toolRound(
        [{ id: 'c1', name: 'calculate', arguments: '{"expression":"1+1"}' }],
        { text: 'Computing.' },
      ),
    );
    answer('2');
    const result = await cli(['-q', '1+1', '--json']);
    expect(parse(result.stdout).answer).toBe('Computing.\n2');
  });

  it('is valid JSON whatever the answer holds', async () => {
    const awkward = 'He said "hi" \\ then\nleft \u0001 \u{1F600} \u2028';
    answer(awkward);
    const result = await cli(['-q', 'say "hi"\n', '--json']);
    expect(parse(result.stdout)).toMatchObject({
      question: 'say "hi"',
      answer: awkward,
    });
  });

  it('stays silent about tool calls and the trace with --verbose', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    api.reply(
      200,
      toolRound([
        { id: 'c1', name: 'calculate', arguments: '{"expression":"1+1"}' },
      ]),
    );
    answer('2');
    const result = await cli(
      ['-q', '1+1', '--json', '--verbose'],
      langfuse(),
      new InMemorySpanExporter(),
    );
    expect(result.stderr).toBe('');
    expect(parse(result.stdout).success).toBe(true);
  });

  it('writes nothing until the run has ended', async () => {
    const stream = api.open();
    const { out, done } = start(['-q', 'hi', '--json']);
    stream.write(
      sseBody(thinkingChunk('Hm.'), contentChunk('Hel')).replace(
        /data: \[DONE\]\n\n$/,
        '',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(out).toEqual({ stdout: '', stderr: '' });
    stream.end(sseBody(contentChunk('lo'), usageChunk(USAGE)));
    expect(await done).toBe(0);
    expect(parse(out.stdout).answer).toBe('Hello');
  });
});

describe('--json model and usage', () => {
  it('adds up the usage of every round, cost included, and names the model of the last', async () => {
    calculate({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cost: 0.001,
    });
    answer(
      '2',
      [],
      {
        prompt_tokens: 30,
        completion_tokens: 8,
        total_tokens: 38,
        cost: 0.002,
      },
      'x/y',
    );
    const result = await cli(['-q', '1+1', '--json']);
    expect(parse(result.stdout)).toMatchObject({
      model: 'x/y',
      usage: {
        promptTokens: 40,
        completionTokens: 13,
        totalTokens: 53,
        cost: 0.003,
      },
    });
  });

  it('leaves the cost out when a round reported none', async () => {
    calculate({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cost: 0.001,
    });
    answer('2');
    const usage = (
      parse((await cli(['-q', '1+1', '--json'])).stdout) as {
        usage: Record<string, unknown>;
      }
    ).usage;
    expect(usage).toEqual({
      promptTokens: 11,
      completionTokens: 6,
      totalTokens: 17,
    });
  });

  it('keeps the reasoning and cached counts the API reports, zero included', async () => {
    answer('4', [], {
      prompt_tokens: 12,
      completion_tokens: 34,
      total_tokens: 46,
      completion_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens_details: { cached_tokens: 7 },
    });
    const result = await cli(['-q', '2+2', '--json']);
    expect(parse(result.stdout)).toMatchObject({
      usage: { reasoningTokens: 0, cachedTokens: 7 },
    });
  });

  it('gives a failed run neither model nor usage, even after a response', async () => {
    calculate({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    api.reply(401, recordedUnauthorized);
    const result = await cli(['-q', '1+1', '--json']);
    const object = parse(result.stderr);
    expect(object.success).toBe(false);
    expect(object).not.toHaveProperty('model');
    expect(object).not.toHaveProperty('usage');
  });
});

describe('--json as the text of a question', () => {
  it('is a question, not the flag', async () => {
    answer('Fine.');
    const result = await cli(['-q', '--json']);
    expect(api.sent.map((sent) => sent.question)).toEqual(['--json']);
    expect(result.stdout).toBe('Fine.\n');
  });
});

describe('--json on failure', () => {
  it('writes the object to stderr, nothing to stdout, and keeps the exit code', async () => {
    api.reply(401, recordedUnauthorized);
    const result = await cli(['-q', 'hi', '--json']);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(2);
    const object = parse(result.stderr) as {
      error: { code: string; message: string };
    };
    expect(object).toMatchObject({
      question: 'hi',
      success: false,
      error: { code: 'API_ERROR' },
    });
    expect(object).not.toHaveProperty('answer');
    expect(object.error.message).toContain('401');
    expect(object.error.message).toContain(RECORDED_401_MESSAGE);
  });

  it('keeps the text written before the failure', async () => {
    api.reply(
      200,
      sseBody(contentChunk('Hel'), errorChunk(500, 'provider failed')),
    );
    const result = await cli(['-q', 'hi', '--json']);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(2);
    expect(parse(result.stderr)).toMatchObject({
      answer: 'Hel',
      success: false,
      error: { code: 'API_ERROR' },
    });
  });

  it('reports a bad argument as a usage error, without a question', async () => {
    const result = await cli([
      '-q',
      'hi',
      '--json',
      '--thinking',
      '--no-thinking',
    ]);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(1);
    const object = parse(result.stderr);
    expect(object).toMatchObject({
      success: false,
      error: { code: 'USAGE_ERROR' },
    });
    expect(object).not.toHaveProperty('question');
    expect(JSON.stringify(object)).not.toContain('Usage:');
  });

  it('lists --json in the usage message of a bad argument given without it', async () => {
    const result = await cli(['--frobnicate']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--json');
  });

  it('reports a missing key as a config error', async () => {
    const result = await cli(['-q', 'hi', '--json'], {
      OPENROUTER_API_KEY: ' ',
    });
    expect(result.code).toBe(1);
    expect(parse(result.stderr)).toMatchObject({
      error: { code: 'CONFIG_ERROR' },
    });
  });

  it('reports a silent model as TIMEOUT, exit 2', async () => {
    api.open();
    const out = { stdout: '', stderr: '' };
    const code = await run(
      ['-q', 'hi', '--json'],
      { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm' },
      {
        serverURL: api.url,
        idleTimeoutMs: 200,
        cwd: dir,
        stdin: { isTTY: false, read: async () => '' },
        stdout: sink(out, 'stdout'),
        stderr: sink(out, 'stderr'),
      },
    );
    // Wait for the request to reach the server, so that it cannot arrive in a later test.
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(code).toBe(2);
    expect(out.stdout).toBe('');
    expect(parse(out.stderr)).toMatchObject({
      success: false,
      error: { code: 'TIMEOUT' },
    });
  });

  it('rejects the Langfuse keys at startup as API_ERROR, exit 2', async () => {
    api.replyGet('/api/public/projects', 401, {
      message: 'Invalid credentials',
    });
    const result = await cli(['-q', 'hi', '--json'], langfuse());
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'API_ERROR' },
    });
  });

  it('reports the round limit with exit code 3', async () => {
    for (let i = 0; i < 9; i++) {
      api.reply(
        200,
        toolRound([
          { id: `c${i}`, name: 'calculate', arguments: '{"expression":"1+1"}' },
        ]),
      );
    }
    const result = await cli(['-q', 'hi', '--json']);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe('');
    expect(parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'LIMIT_EXCEEDED' },
    });
  });

  it('never holds the Langfuse keys', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    api.reply(500, `provider echoed ${PK} and ${SK}`);
    const result = await cli(
      ['-q', 'hi', '--json'],
      langfuse(),
      new InMemorySpanExporter(),
    );
    expect(parse(result.stderr).success).toBe(false);
    expect(result.stderr).not.toContain(PK);
    expect(result.stderr).not.toContain(SK);
  });

  it('reports a failure the tool did not foresee as UNEXPECTED_ERROR, exit 2', async () => {
    const out = { stdout: '', stderr: '' };
    const code = await run(
      ['--json'],
      { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm' },
      {
        serverURL: api.url,
        cwd: dir,
        stdin: {
          isTTY: false,
          read: async () => {
            throw new Error('stdin broke');
          },
        },
        stdout: sink(out, 'stdout'),
        stderr: sink(out, 'stderr'),
      },
    );
    expect(code).toBe(2);
    expect(out.stdout).toBe('');
    expect(parse(out.stderr)).toMatchObject({
      success: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: 'Unexpected error: stdin broke',
      },
    });
  });

  it('never holds the API key', async () => {
    api.reply(500, `provider echoed ${KEY}`);
    const result = await cli(['-q', 'hi', '--json']);
    expect(result.stderr).not.toContain(KEY);
    expect(parse(result.stderr).success).toBe(false);
  });
});

describe('--json and a trace that is lost', () => {
  const refusing: SpanExporter = {
    export: (_spans, done) =>
      done({ code: ExportResultCode.FAILED, error: new Error('refused') }),
    shutdown: async () => {},
  };

  it('keeps the success object and reports the loss on stderr, exit 2', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    answer('4');
    const result = await cli(['-q', '2+2', '--json'], langfuse(), refusing);
    expect(parse(result.stdout).success).toBe(true);
    expect(parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'TRACE_FLUSH_FAILED' },
    });
    expect(result.code).toBe(2);
  });

  it('writes only the failure of a run that failed', async () => {
    api.replyGet('/api/public/projects', 200, { data: [] });
    api.reply(401, recordedUnauthorized);
    const result = await cli(['-q', '2+2', '--json'], langfuse(), refusing);
    expect(parse(result.stderr)).toMatchObject({
      error: { code: 'API_ERROR' },
    });
    expect(result.code).toBe(2);
  });
});
