import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemorySpanExporter,
  type ReadableSpan,
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
  RECORDED_TOOL_ROUND,
  recordedModel,
  recordedToolStream,
  sseBody,
  usageChunk,
} from './fixtures.js';
import { sink } from './sink.js';

// Retries wait between attempts; tests must not.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const KEY = 'sk-or-v1-marker-do-not-print';
const QUESTION = 'Compare the two gpt-oss models.';

let api: FakeApi;
let emptyDir: string;
let exporter: InMemorySpanExporter;

/** Langfuse lives on the same loopback server as the API, at its root. */
const langfuseURL = () => api.url.replace(/\/api\/v1$/, '');

const tracedEnv = () => ({
  OPENROUTER_API_KEY: KEY,
  OPENROUTER_MODEL: 'env/model',
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
  LANGFUSE_BASE_URL: langfuseURL(),
});

const cli = async (argv: string[], extraEnv: Record<string, string> = {}) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(
    argv,
    { ...tracedEnv(), ...extraEnv },
    {
      serverURL: api.url,
      tracing: { exporter },
      cwd: emptyDir,
      stdin: { isTTY: true, read: async () => '' },
      stdout: sink(out, 'stdout'),
      stderr: sink(out, 'stderr'),
    },
  );
  return { code, ...out };
};

const queueTwoRounds = () => {
  api.replyGet('/api/public/projects', 200, { data: [] });
  api.reply(200, recordedToolStream);
  for (const call of RECORDED_TOOL_ROUND.calls) {
    const slug = (JSON.parse(call.arguments) as { slug: string }).slug;
    api.replyGet(`/model/${slug}`, 200, {
      data: { ...recordedModel.data, id: slug },
    });
  }
  api.reply(
    200,
    sseBody(
      contentChunk('Both are cheap.'),
      usageChunk({
        prompt_tokens: 700,
        completion_tokens: 50,
        total_tokens: 750,
        cost: 0.0021,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 20 },
      }),
    ),
  );
};

interface Node {
  name: string;
  type: unknown;
  children: Node[];
}

const nanos = (span: ReadableSpan) =>
  span.startTime[0] * 1e9 + span.startTime[1];

/** The exported spans as a tree, children in the order they started. */
const tree = (spans: ReadableSpan[]): Node[] => {
  const build = (parentId: string | undefined): Node[] =>
    spans
      .filter((span) => span.parentSpanContext?.spanId === parentId)
      .sort((a, b) => nanos(a) - nanos(b))
      .map((span) => ({
        name: span.name,
        type: span.attributes['langfuse.observation.type'],
        children: build(span.spanContext().spanId),
      }));
  return build(undefined);
};

/** A string input or output is stored as it is. */
const attribute = (span: ReadableSpan | undefined, key: string): unknown =>
  span?.attributes[key];

beforeAll(async () => {
  api = await startFakeApi();
  emptyDir = await mkdtemp(join(tmpdir(), 'trace-cwd-'));
});
afterAll(async () => {
  await api.close();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => {
  api.reset();
  exporter = new InMemorySpanExporter();
});

describe('a traced question that needs tools', () => {
  it('exports one agent root with a generation per round and a tool per call, in order', async () => {
    queueTwoRounds();
    const result = await cli(['-q', QUESTION]);
    expect(result.code).toBe(0);
    expect(tree(exporter.getFinishedSpans())).toEqual([
      {
        name: 'answer-question',
        type: 'agent',
        children: [
          {
            name: 'generate-response',
            type: 'generation',
            children: [
              { name: 'receive-first-token', type: 'event', children: [] },
            ],
          },
          { name: 'get_model', type: 'tool', children: [] },
          { name: 'get_model', type: 'tool', children: [] },
          {
            name: 'generate-response',
            type: 'generation',
            children: [
              { name: 'receive-first-token', type: 'event', children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('puts the question and the answer on the root, which become the trace input and output', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    const root = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'answer-question');
    expect(attribute(root, 'langfuse.observation.input')).toBe(QUESTION);
    expect(attribute(root, 'langfuse.observation.output')).toBe(
      'Both are cheap.',
    );
  });

  it('shares one trace id across every observation', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    const ids = new Set(
      exporter.getFinishedSpans().map((span) => span.spanContext().traceId),
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('delivers the whole tree before the run returns', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    expect(exporter.getFinishedSpans()).toHaveLength(7);
  });

  it('exports none of the three keys, though the question holds them, while the model still gets the question as written', async () => {
    queueTwoRounds();
    const question = `my keys: ${KEY} pk-lf-test sk-lf-test`;
    await cli(['-q', question]);
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((span) => span.attributes),
    );
    for (const secret of [KEY, 'pk-lf-test', 'sk-lf-test']) {
      expect(everything).not.toContain(secret);
    }
    expect(api.sent.find((sent) => sent.method === 'POST')?.question).toBe(
      question,
    );
  });

  const named = (name: string) =>
    exporter
      .getFinishedSpans()
      .filter((span) => span.name === name)
      .sort((a, b) => nanos(a) - nanos(b));

  it('records the buckets and the cost of every generation, with the odd counts kept out of them', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    const [, second] = named('generate-response');
    expect(attribute(second, 'langfuse.observation.usage_details')).toBe(
      JSON.stringify({
        input: 500,
        input_cached_tokens: 200,
        output: 30,
        output_reasoning_tokens: 20,
        total: 750,
      }),
    );
    expect(attribute(second, 'langfuse.observation.cost_details')).toBe(
      JSON.stringify({ total: 0.0021 }),
    );
  });

  it('stamps the version of the package on every observation', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    const { version } = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.attributes['langfuse.version']).toBe(version);
    }
  });

  it('sends each request a traceparent naming the observation that makes it', async () => {
    queueTwoRounds();
    await cli(['-q', QUESTION]);
    const [first, second] = named('generate-response');
    const tools = named('get_model');
    const traceId = first?.spanContext().traceId;
    const header = (id: string | undefined) => `00-${traceId}-${id}-01`;
    const posts = api.sent.filter((sent) => sent.method === 'POST');
    expect(posts.map((sent) => sent.traceparent)).toEqual([
      header(first?.spanContext().spanId),
      header(second?.spanContext().spanId),
    ]);
    const gets = api.sent
      .filter(
        (sent) => sent.method === 'GET' && sent.path.startsWith('/api/v1'),
      )
      .map((sent) => sent.traceparent);
    expect(new Set(gets).size).toBe(2);
    expect(new Set(gets)).toEqual(
      new Set(tools.map((tool) => header(tool.spanContext().spanId))),
    );
  });

  it('writes the trace id first on stderr with --verbose, and not without it', async () => {
    queueTwoRounds();
    const verbose = await cli(['-q', QUESTION, '--verbose']);
    const traceId = exporter.getFinishedSpans()[0]?.spanContext().traceId;
    expect(verbose.stderr.split('\n')[0]).toBe(`trace: ${traceId}`);
    api.reset();
    exporter.reset();
    queueTwoRounds();
    const quiet = await cli(['-q', QUESTION]);
    expect(quiet.stderr).not.toContain('trace:');
  });

  it('sends no traceparent and shows no trace line in a run that is not traced', async () => {
    api.reply(200, sseBody(contentChunk('Fine.'), usageChunk()));
    const out = { stdout: '', stderr: '' };
    await run(
      ['-q', QUESTION, '--verbose'],
      { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm' },
      {
        serverURL: api.url,
        cwd: emptyDir,
        stdin: { isTTY: true, read: async () => '' },
        stdout: sink(out, 'stdout'),
        stderr: sink(out, 'stderr'),
      },
    );
    expect(api.sent.map((sent) => sent.traceparent)).toEqual([undefined]);
    expect(out.stderr).not.toContain('trace:');
  });

  it('masks an email in the question for the trace only, and exports no header and no variable name', async () => {
    queueTwoRounds();
    const question = 'Compare these for a@b.io please.';
    await cli(['-q', question]);
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((span) => [span.name, span.attributes]),
    );
    expect(everything).not.toContain('a@b.io');
    expect(everything).toContain('[REDACTED]');
    expect(everything.toLowerCase()).not.toContain('authorization');
    expect(everything).not.toMatch(
      /OPENROUTER_API_KEY|LANGFUSE_SECRET_KEY|LANGFUSE_PUBLIC_KEY/,
    );
    expect(api.sent.find((sent) => sent.method === 'POST')?.question).toBe(
      question,
    );
  });

  it('hides keys that have no recognisable shape, because it knows them', async () => {
    queueTwoRounds();
    const keys = {
      OPENROUTER_API_KEY: 'plainOpenRouterKey9f8e7d',
      LANGFUSE_PUBLIC_KEY: 'plainPublicKey9f8e7d',
      LANGFUSE_SECRET_KEY: 'plainSecretKey9f8e7d',
    };
    await cli(['-q', `my keys: ${Object.values(keys).join(' ')}`], keys);
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((span) => span.attributes),
    );
    for (const secret of Object.values(keys)) {
      expect(everything).not.toContain(secret);
    }
  });
});
