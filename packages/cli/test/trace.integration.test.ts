import { mkdtemp, rm } from 'node:fs/promises';
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

const cli = async (argv: string[]) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(argv, tracedEnv(), {
    serverURL: api.url,
    tracing: { exporter },
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
          { name: 'generate-response', type: 'generation', children: [] },
          { name: 'get_model', type: 'tool', children: [] },
          { name: 'get_model', type: 'tool', children: [] },
          { name: 'generate-response', type: 'generation', children: [] },
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
    expect(exporter.getFinishedSpans()).toHaveLength(5);
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
});
