import { mkdtemp, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import fc from 'fast-check';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { afterFlush, run } from '../src/cli.js';
import { type FakeApi, startFakeApi, withServer } from './fakeApi.js';
import { contentChunk, sseBody, usageChunk } from './fixtures.js';
import { sink } from './sink.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const OR_KEY = 'sk-or-v1-marker';
const PK = 'pk-lf-marker';
const SK = 'sk-lf-marker';

let api: FakeApi;
let dir: string;
let exporter: InMemorySpanExporter;

const origin = () => api.url.replace(/\/api\/v1$/, '');
const full = () => ({
  LANGFUSE_PUBLIC_KEY: PK,
  LANGFUSE_SECRET_KEY: SK,
  LANGFUSE_BASE_URL: origin(),
});

const cli = async (
  env: Record<string, string>,
  { exportTo = exporter as SpanExporter, stdin = async () => '' } = {},
  argv = ['-q', 'hi'],
) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(
    argv,
    { OPENROUTER_API_KEY: OR_KEY, OPENROUTER_MODEL: 'm', ...env },
    {
      serverURL: api.url,
      tracing: { exporter: exportTo },
      cwd: dir,
      stdin: { isTTY: false, read: stdin },
      stdout: sink(out, 'stdout'),
      stderr: sink(out, 'stderr'),
    },
  );
  return { code, ...out };
};

const answer = () =>
  api.reply(
    200,
    sseBody(
      contentChunk('Fine.'),
      usageChunk({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ),
  );
const projectsOk = () =>
  api.replyGet('/api/public/projects', 200, { data: [] });
const posts = () => api.sent.filter((s) => s.method === 'POST');
const lines = (text: string) => text.split('\n').filter(Boolean);

beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-trace-'));
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  api.reset();
  exporter = new InMemorySpanExporter();
});

describe('without Langfuse variables', () => {
  it('runs untraced, with one warning on stderr naming the variables, and asks Langfuse nothing', async () => {
    answer();
    const result = await cli({});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Fine.\n');
    const warnings = lines(result.stderr).filter((l) => /langfuse/i.test(l));
    expect(warnings).toHaveLength(1);
    for (const name of [
      'LANGFUSE_PUBLIC_KEY',
      'LANGFUSE_SECRET_KEY',
      'LANGFUSE_BASE_URL',
    ]) {
      expect(warnings[0]).toContain(name);
    }
    expect(api.sent.filter((s) => s.path.startsWith('/api/public'))).toEqual(
      [],
    );
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});

describe('with some of the variables', () => {
  it('exits 1 before any request, and before reading stdin', async () => {
    const stdin = vi.fn(async () => 'never');
    const result = await cli({ LANGFUSE_PUBLIC_KEY: PK }, { stdin }, []);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('LANGFUSE_SECRET_KEY');
    expect(result.stderr).toContain('LANGFUSE_BASE_URL');
    expect(result.stdout).toBe('');
    expect(stdin).not.toHaveBeenCalled();
    expect(api.sent).toEqual([]);
  });
});

describe('the credential check', () => {
  it('stops a run whose keys are rejected: one line, exit 2, nothing sent to the model, no key shown', async () => {
    api.replyGet('/api/public/projects', 401, { message: 'no' });
    const result = await cli(full());
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toMatch(/rejected/);
    expect(posts()).toEqual([]);
    for (const secret of [PK, SK, OR_KEY]) {
      expect(result.stderr).not.toContain(secret);
    }
  });

  it('stops a run whose Langfuse cannot be reached, naming the base URL', async () => {
    const result = await cli({
      ...full(),
      LANGFUSE_BASE_URL: 'http://127.0.0.1:1',
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('http://127.0.0.1:1');
    expect(posts()).toEqual([]);
  });
});

describe('delivering the trace', () => {
  it('delivers it when the run fails, with the error on the root, and keeps the exit code', async () => {
    projectsOk();
    api.reply(401, { error: { code: 401, message: 'No auth.' } });
    const result = await cli(full());
    expect(result.code).toBe(2);
    const root = exporter
      .getFinishedSpans()
      .find((s: ReadableSpan) => s.name === 'answer-question');
    expect(root?.attributes['langfuse.observation.level']).toBe('ERROR');
  });

  it('writes one line and exits 2 when the answer was written but the trace was lost', async () => {
    projectsOk();
    answer();
    const refusing: SpanExporter = {
      export: (_spans, done) =>
        done({ code: ExportResultCode.FAILED, error: new Error('refused') }),
      shutdown: async () => {},
    };
    const result = await cli(full(), { exportTo: refusing });
    expect(result.stdout).toBe('Fine.\n');
    expect(
      lines(result.stderr).filter((line) => /incomplete/i.test(line)),
    ).toEqual([expect.stringMatching(/trace .*incomplete/i)]);
    expect(result.code).toBe(2);
  });
});

describe('afterFlush', () => {
  it('keeps the code of the run when the flush worked', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (code) => {
        expect(afterFlush(code, false)).toBe(code);
      }),
    );
  });

  it('turns a clean exit into 2 and keeps any other code when the flush failed', () => {
    expect(afterFlush(0, true)).toBe(2);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (code) => {
        expect(afterFlush(code, true)).toBe(code);
      }),
    );
  });

  it('never lowers an exit code that was not zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (code, failed) => {
          expect(afterFlush(code, failed)).toBeGreaterThanOrEqual(code);
        },
      ),
    );
  });
});

describe('an interrupt', () => {
  it('ends the open observations as errors, delivers them, and returns the signal code', async () => {
    projectsOk();
    const stream = api.open();
    const controller = new AbortController();
    const out = { stdout: '', stderr: '' };
    const running = run(
      ['-q', 'hi'],
      { OPENROUTER_API_KEY: OR_KEY, OPENROUTER_MODEL: 'm', ...full() },
      {
        serverURL: api.url,
        tracing: { exporter },
        signal: controller.signal,
        cwd: dir,
        stdin: { isTTY: false, read: async () => '' },
        stdout: sink(out, 'stdout'),
        stderr: sink(out, 'stderr'),
      },
    );
    stream.write(
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Partial' }, finish_reason: null }] })}\n\n`,
    );
    await vi.waitFor(() => expect(out.stdout).toContain('Partial'));
    controller.abort('SIGINT');
    expect(await running).toBe(130);
    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name).sort()).toEqual([
      'answer-question',
      'generate-response',
    ]);
    for (const s of spans) {
      expect(s.attributes['langfuse.observation.level']).toBe('ERROR');
      expect(s.attributes['langfuse.observation.status_message']).toBe(
        'The run was interrupted.',
      );
    }
    stream.destroy();
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])('returns 128 plus the signal number for %s', async (signal, code) => {
    projectsOk();
    const stream = api.open();
    const controller = new AbortController();
    const running = run(
      ['-q', 'hi'],
      { OPENROUTER_API_KEY: OR_KEY, OPENROUTER_MODEL: 'm', ...full() },
      {
        serverURL: api.url,
        tracing: { exporter },
        signal: controller.signal,
        cwd: dir,
        stdin: { isTTY: false, read: async () => '' },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    );
    await vi.waitFor(() => expect(posts()).not.toHaveLength(0));
    controller.abort(signal);
    expect(await running).toBe(code);
    stream.destroy();
  });
});

describe('the real exporter', () => {
  /** A Langfuse stand-in on a real socket: it accepts the credential check and answers the upload with `uploadStatus`. */
  const langfuse = async (
    uploadStatus: number,
    test: (origin: string, uploads: IncomingMessage[]) => Promise<void>,
  ) => {
    const uploads: IncomingMessage[] = [];
    await withServer(
      (request, response) => {
        request.resume();
        if (request.method === 'POST') {
          uploads.push(request);
        }
        response.writeHead(request.method === 'POST' ? uploadStatus : 200, {
          'content-type': 'application/json',
        });
        response.end('{}');
      },
      (serverURL) => test(serverURL.replace(/\/api\/v1$/, ''), uploads),
    );
  };

  const realCli = async (origin: string) => {
    const out = { stdout: '', stderr: '' };
    const code = await run(
      ['-q', 'hi'],
      {
        OPENROUTER_API_KEY: OR_KEY,
        OPENROUTER_MODEL: 'm',
        ...full(),
        LANGFUSE_BASE_URL: origin,
      },
      {
        serverURL: api.url,
        cwd: dir,
        stdin: { isTTY: false, read: async () => '' },
        stdout: sink(out, 'stdout'),
        stderr: sink(out, 'stderr'),
      },
    );
    return { code, ...out };
  };

  it('posts the trace to Langfuse with the keys, and exits 0', async () => {
    answer();
    await langfuse(200, async (origin, uploads) => {
      const result = await realCli(origin);
      expect(result.code).toBe(0);
      expect(uploads.map((u) => u.url)).toEqual(['/api/public/otel/v1/traces']);
      expect(uploads[0]?.headers.authorization).toBe(
        `Basic ${Buffer.from(`${PK}:${SK}`).toString('base64')}`,
      );
    });
  });

  it('reports a lost trace, and exits 2, when Langfuse answers 500 to the upload', async () => {
    answer();
    await langfuse(500, async (origin) => {
      const result = await realCli(origin);
      expect(result.stdout).toBe('Fine.\n');
      expect(result.stderr).toMatch(/trace .*incomplete/i);
      expect(result.code).toBe(2);
    });
  });
});
