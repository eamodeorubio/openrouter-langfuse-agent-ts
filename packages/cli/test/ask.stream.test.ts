import type { ServerResponse } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type AskOptions, ask } from '../src/ask.js';
import { ApiError } from '../src/errors.js';
import type { AskEvent } from '../src/types.js';
import { type FakeApi, startFakeApi, withServer } from './fakeApi.js';
import {
  contentChunk,
  DONE,
  errorChunk,
  RECORDED_ANSWER,
  RECORDED_MODEL,
  RECORDED_REASONING_TOKENS,
  RECORDED_STREAM_ANSWER,
  RECORDED_STREAM_MODEL,
  RECORDED_STREAM_THINKING,
  RECORDED_STREAM_USAGE,
  RECORDED_USAGE,
  recordedCompletion,
  recordedStream,
  sseBody,
  sseEvent,
  streamChunk,
  thinkingChunk,
  usageChunk,
  usageOnlyChunk,
} from './fixtures.js';

// Every test here opens a stream and most abandon or cut one. They run against
// a real loopback server (see fakeApi.ts), not `nock`, whose mock sockets
// cannot survive a cancel. `nock` is deliberately not imported in this file.

const waits = vi.hoisted(() => [] as number[]);
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    waits.push(ms);
  },
}));

const config = { apiKey: 'sk-test', model: 'req/model' };
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };
const good = sseBody(contentChunk('42'), usageChunk(USAGE));

let api: FakeApi;

type Step = [status: number, payload: unknown];

/** Answers the first request with the first step, the second with the second, and so on. */
const serve = (...steps: Step[]) => {
  for (const [status, payload] of steps) {
    api.reply(status, payload);
  }
};

/** Answers every request the same way, enough to outlast the retries. */
const serveAlways = (status: number, payload: unknown) =>
  api.replyTimes(5, status, payload);

const reply = (status: number, payload: unknown) => api.reply(status, payload);

/** Runs `ask` to the end, keeping the events that came before any failure. */
const collect = async (options?: AskOptions) => {
  const events: AskEvent[] = [];
  let error: unknown;
  try {
    for await (const event of ask(config, 'hi', {
      serverURL: api.url,
      ...options,
    })) {
      events.push(event);
    }
  } catch (caught) {
    error = caught;
  }
  return { events, error };
};

const failure = async (options?: AskOptions) => {
  const { events, error } = await collect(options);
  expect(error).toBeInstanceOf(ApiError);
  return { events, message: (error as ApiError).message };
};

const textOf = (events: AskEvent[], kind: 'thinking' | 'content') =>
  events.flatMap((e) => (e.kind === kind ? [e.text] : [])).join('');

const streamHead = (response: ServerResponse) =>
  response.writeHead(200, { 'content-type': 'text/event-stream' });

/**
 * Waits for something the server should see, such as the client hanging up.
 * The limit is a ceiling for a slow machine, not a delay: the wait ends as
 * soon as the condition holds, and a miss means it never happened.
 */
const EVENTUALLY_LIMIT_MS = 10_000;
const eventually = async (condition: () => boolean) => {
  for (let i = 0; i < EVENTUALLY_LIMIT_MS / 10 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
};

beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(() => api.close());
beforeEach(() => {
  api.reset();
  waits.length = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => vi.restoreAllMocks());

describe('ask: the events', () => {
  it('yields the recorded thinking, then the answer, then the model and usage', async () => {
    reply(200, recordedStream);
    const { events, error } = await collect();
    expect(error).toBeUndefined();
    expect(textOf(events, 'thinking')).toBe(RECORDED_STREAM_THINKING);
    expect(textOf(events, 'content')).toBe(RECORDED_STREAM_ANSWER);
    expect(events.at(-1)).toEqual({
      kind: 'done',
      model: RECORDED_STREAM_MODEL,
      usage: {
        promptTokens: RECORDED_STREAM_USAGE.promptTokens,
        completionTokens: RECORDED_STREAM_USAGE.completionTokens,
        totalTokens: RECORDED_STREAM_USAGE.totalTokens,
        reasoningTokens: RECORDED_STREAM_USAGE.reasoningTokens,
      },
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds.lastIndexOf('thinking')).toBeLessThan(
      kinds.indexOf('content'),
    );
  });

  it('yields one event per non-empty piece of text, in order', async () => {
    reply(
      200,
      sseBody(
        thinkingChunk('a'),
        thinkingChunk('b'),
        streamChunk({ content: '' }),
        contentChunk('4'),
        contentChunk('2'),
        usageChunk(USAGE),
      ),
    );
    const { events } = await collect();
    expect(
      events.map((e) =>
        e.kind === 'done' || e.kind === 'tool' || e.kind === 'trace'
          ? e.kind
          : e.text,
      ),
    ).toEqual(['a', 'b', '4', '2', 'done']);
  });

  it('leaves the reasoning count out when the usage has none', async () => {
    reply(200, good);
    const { events } = await collect();
    expect(events.at(-1)).toEqual({
      kind: 'done',
      model: 'test/model',
      usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
    });
  });

  it('accepts zero token counts', async () => {
    reply(
      200,
      sseBody(
        contentChunk('x'),
        usageChunk({
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        }),
      ),
    );
    const { events } = await collect();
    expect(events.at(-1)).toMatchObject({
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  });

  it('reads usage from a chunk whose choices list is empty', async () => {
    reply(200, sseBody(contentChunk('42'), usageOnlyChunk(USAGE)));
    const { events, error } = await collect();
    expect(error).toBeUndefined();
    expect(textOf(events, 'content')).toBe('42');
    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
    });
  });

  it('yields nothing for encrypted or summary-only reasoning', async () => {
    const detail = (type: string, extra: object) =>
      streamChunk({
        content: '',
        reasoning_details: [{ type, format: 'unknown', index: 0, ...extra }],
      });
    reply(
      200,
      sseBody(
        detail('reasoning.encrypted', { data: 'ENCRYPTED-BLOB' }),
        detail('reasoning.summary', { summary: 'SUMMARY-TEXT' }),
        contentChunk('x'),
        usageChunk(USAGE),
      ),
    );
    const { events } = await collect();
    expect(events.map((e) => e.kind)).toEqual(['content', 'done']);
  });
});

describe('ask: the idle limit', () => {
  it('is 60 seconds when nothing says otherwise', async () => {
    const delays: unknown[] = [];
    const realSet = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      ms?: number,
    ) => {
      delays.push(ms);
      return realSet(callback, ms);
    }) as typeof setTimeout);
    reply(200, good);
    const { error } = await collect();
    expect(error).toBeUndefined();
    expect(delays).toContain(60_000);
  });
});

describe('ask: housekeeping', () => {
  // A timer left running holds the process open after the answer is done. The
  // idle timers are told apart by a duration nothing else uses, and each one
  // must be cleared however the wait ends.
  it.each([
    ['the stream has ended', () => reply(200, good)],
    [
      'the request has failed',
      () => reply(401, { error: { code: 401, message: 'no' } }),
    ],
    [
      'the stream has failed',
      () =>
        reply(
          200,
          sseBody(contentChunk('Hel'), errorChunk(500, 'provider failed')),
        ),
    ],
  ])('clears every idle timer it starts once %s', async (_name, arrange) => {
    const idle = 54_321;
    const started: unknown[] = [];
    const cleared: unknown[] = [];
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      ms?: number,
    ) => {
      const handle = realSet(callback, ms);
      if (ms === idle) {
        started.push(handle);
      }
      return handle;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
      handle?: Parameters<typeof clearTimeout>[0],
    ) => {
      cleared.push(handle);
      realClear(handle);
    }) as typeof clearTimeout);
    arrange();
    await collect({ idleTimeoutMs: idle });
    expect(started.length).toBeGreaterThan(0);
    for (const handle of started) {
      expect(cleared).toContain(handle);
    }
  });
});

describe('ask: a server that answers without streaming', () => {
  const message = (overrides: object = {}) => ({
    ...(recordedCompletion.choices as { message: object }[])[0]?.message,
    ...overrides,
  });
  const complete = (messageOverrides?: object) => ({
    ...recordedCompletion,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: message(messageOverrides),
      },
    ],
  });

  it('treats a complete response as a stream of a single chunk', async () => {
    reply(200, recordedCompletion);
    const { events, error } = await collect();
    expect(error).toBeUndefined();
    expect(events).toEqual([
      { kind: 'thinking', text: 'The user wants a single word reply: "pong".' },
      { kind: 'content', text: RECORDED_ANSWER },
      {
        kind: 'done',
        model: RECORDED_MODEL,
        usage: {
          ...RECORDED_USAGE,
          reasoningTokens: RECORDED_REASONING_TOKENS,
        },
      },
    ]);
  });

  it('yields no thinking event when the response holds none', async () => {
    reply(200, complete({ reasoning: null }));
    const { events } = await collect();
    expect(events.map((e) => e.kind)).toEqual(['content', 'done']);
  });

  it.each([
    ['an empty choices list', { ...recordedCompletion, choices: [] }],
    ['empty content', complete({ content: '' })],
    ['content that is not text', complete({ content: null })],
    [
      'content in parts, not text',
      complete({ content: [{ type: 'text', text: 'pong' }] }),
    ],
  ])(
    'rejects a complete response with %s as having no answer',
    async (_name, body) => {
      reply(200, body);
      expect((await failure()).message).toBe(
        'The API response held no answer.',
      );
    },
  );

  it.each([
    ['a choices field that is not a list', { choices: 'not a list' }],
    ['a choice without a message', { choices: [{ index: 0 }] }],
  ])(
    'reports a complete response with %s as a bad response, not a crash',
    async (_name, overrides) => {
      reply(200, { ...recordedCompletion, ...overrides });
      expect((await failure()).message).toBe(
        'The API response did not have the expected shape.',
      );
    },
  );

  it('rejects a complete response without usage', async () => {
    reply(200, { ...recordedCompletion, usage: undefined });
    const { events, message: text } = await failure();
    expect(text).toBe('The API response held no token usage.');
    expect(events.map((e) => e.kind)).toEqual(['thinking', 'content']);
  });
});

describe('ask: failures inside the stream', () => {
  it('throws an error chunk as an API error, after the text that came before it', async () => {
    reply(
      200,
      sseBody(contentChunk('Hel'), errorChunk(500, 'provider failed')),
    );
    const { events, message } = await failure();
    expect(message).toBe('API error 500: provider failed');
    expect(events).toEqual([{ kind: 'content', text: 'Hel' }]);
  });

  it.each([
    ['no choices at all', sseBody(), /no answer/i],
    [
      'only a chunk with an empty choices list',
      sseBody(usageOnlyChunk(USAGE)),
      /no answer/i,
    ],
    [
      'only thinking',
      sseBody(thinkingChunk('hmm'), usageChunk(USAGE)),
      /no answer/i,
    ],
    [
      'only empty content',
      sseBody(contentChunk(''), usageChunk(USAGE)),
      /no answer/i,
    ],
    ['an answer and no usage', sseBody(contentChunk('42')), /token usage/i],
  ])('rejects a stream with %s', async (_name, body, message) => {
    reply(200, body);
    expect((await failure()).message).toMatch(message);
  });

  it('keeps the text and thinking that arrived before the stream proved unusable', async () => {
    reply(200, sseBody(thinkingChunk('hmm'), contentChunk('42')));
    const { events } = await failure();
    expect(events.map((e) => e.kind)).toEqual(['thinking', 'content']);
  });

  it('turns a 200 body the SDK cannot parse into an API error without the validation dump', async () => {
    serveAlways(200, { error: { code: 502, message: 'provider down' } });
    expect((await failure()).message).toBe(
      'The API response did not have the expected shape.',
    );
    expect(api.sent.length).toBe(1);
  });

  it.each([
    ['a choices field that is not a list', '{"choices": "not a list"}'],
    ['required fields missing', '{"id": "x"}'],
    ['something that is not JSON', 'this is not json'],
  ])(
    'reports a chunk with %s as a bad response, without the validation dump, and does not retry it',
    async (_name, data) => {
      serveAlways(200, `data: ${data}\n\n${DONE}`);
      const { message } = await failure();
      expect(message).toBe('The API response did not have the expected shape.');
      expect(api.sent).toHaveLength(1);
      expect(waits).toEqual([]);
    },
  );
});

describe('ask: retries inside the stream', () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
  ])(
    'treats an error chunk with code %i before any output as retryable: %s',
    async (code, retried) => {
      serve([200, sseBody(errorChunk(code, 'chunk error'))], [200, good]);
      const { error } = await collect();
      expect(api.sent.length).toBe(retried ? 2 : 1);
      expect(error === undefined).toBe(retried);
    },
  );

  it('does not retry a stream that held no answer', async () => {
    serve([200, sseBody()], [200, good]);
    await failure();
    expect(api.sent.length).toBe(1);
    expect(waits).toEqual([]);
  });

  it('does not retry an error chunk once text has been yielded', async () => {
    serve(
      [200, sseBody(contentChunk('Hel'), errorChunk(503, 'overloaded'))],
      [200, good],
    );
    const { events } = await failure();
    expect(api.sent.length).toBe(1);
    expect(events).toEqual([{ kind: 'content', text: 'Hel' }]);
    expect(waits).toEqual([]);
  });

  it('does not retry once only thinking has been yielded', async () => {
    serve(
      [200, sseBody(thinkingChunk('hm'), errorChunk(503, 'overloaded'))],
      [200, good],
    );
    await failure();
    expect(api.sent.length).toBe(1);
  });
});

// Twice the limit of `eventually`: room for that wait plus the test's own work.
describe('ask: a stream that is cut off or goes quiet', {
  timeout: EVENTUALLY_LIMIT_MS * 2,
}, () => {
  const IDLE = 300;

  // The SDK's first request in a process pays a start-up cost of tens of
  // milliseconds. These tests run on a 300 ms limit, so they start warm.
  beforeAll(async () => {
    await withServer(
      (_request, response) => {
        streamHead(response);
        response.write(sseEvent(contentChunk('warm')));
        response.write(sseEvent(usageChunk(USAGE)));
        response.end(DONE);
      },
      async (serverURL) => {
        await collect({ serverURL });
      },
    );
  });

  const options = (serverURL: string): AskOptions => ({
    idleTimeoutMs: IDLE,
    serverURL,
  });

  it('times out when the server never answers, hangs up, and does not retry', async () => {
    let hits = 0;
    let hungUp = false;
    const started = Date.now();
    await withServer(
      (_request, response) => {
        hits++;
        response.on('close', () => {
          hungUp = true;
        });
      },
      async (serverURL) => {
        const { events, message } = await failure(options(serverURL));
        expect(message).toBe('Request timed out: no data for 0.3 s.');
        expect(events).toEqual([]);
        expect(Date.now() - started).toBeGreaterThanOrEqual(IDLE - 20);
        await eventually(() => hungUp);
      },
    );
    expect(hits).toBe(1);
    expect(waits).toEqual([]);
  });

  it('counts the first-chunk wait from sending the request, not from the response', async () => {
    let elapsed = 0;
    await withServer(
      (_request, response) => {
        setTimeout(() => {
          streamHead(response);
          response.flushHeaders();
        }, IDLE * 0.8);
      },
      async (serverURL) => {
        const started = Date.now();
        const { message } = await failure(options(serverURL));
        elapsed = Date.now() - started;
        expect(message).toMatch(/timed out/i);
      },
    );
    // Counted from sending: about IDLE. Counted from the response: about 1.8 * IDLE.
    expect(elapsed).toBeGreaterThanOrEqual(IDLE - 20);
    expect(elapsed).toBeLessThan(IDLE * 1.5);
  });

  it('waits for a first chunk that comes after the response, within the limit', async () => {
    await withServer(
      (_request, response) => {
        streamHead(response);
        response.flushHeaders();
        setTimeout(() => {
          response.write(sseEvent(contentChunk('late')));
          response.write(sseEvent(usageChunk(USAGE)));
          response.end(DONE);
        }, IDLE * 0.3);
      },
      async (serverURL) => {
        const { events, error } = await collect(options(serverURL));
        expect(error).toBeUndefined();
        expect(textOf(events, 'content')).toBe('late');
      },
    );
  });

  it('times out on a gap after text has arrived, keeps the text, hangs up, and does not retry', async () => {
    let hits = 0;
    let hungUp = false;
    await withServer(
      (_request, response) => {
        hits++;
        response.on('close', () => {
          hungUp = true;
        });
        streamHead(response);
        response.write(sseEvent(contentChunk('Hel')));
      },
      async (serverURL) => {
        const { events, message } = await failure(options(serverURL));
        expect(message).toBe('Request timed out: no data for 0.3 s.');
        expect(events).toEqual([{ kind: 'content', text: 'Hel' }]);
        await eventually(() => hungUp);
      },
    );
    expect(hits).toBe(1);
    expect(waits).toEqual([]);
  });

  it('lets go of the connection when the stream fails with an error chunk', async () => {
    let hungUp = false;
    await withServer(
      (_request, response) => {
        response.on('close', () => {
          hungUp = true;
        });
        streamHead(response);
        response.write(sseEvent(contentChunk('Hel')));
        response.write(sseEvent(errorChunk(500, 'provider failed')));
        // The server keeps the connection open, as a provider might.
      },
      async (serverURL) => {
        const { message } = await failure(options(serverURL));
        expect(message).toBe('API error 500: provider failed');
        await eventually(() => hungUp);
      },
    );
  });

  it('never cuts a stream that keeps delivering chunks, however long it takes in all', async () => {
    const pieces = Array.from({ length: 25 }, (_, i) => String(i % 10));
    const started = Date.now();
    await withServer(
      async (_request, response) => {
        streamHead(response);
        for (const piece of pieces) {
          response.write(sseEvent(contentChunk(piece)));
          await new Promise((resolve) => setTimeout(resolve, IDLE / 10));
        }
        response.write(sseEvent(usageChunk(USAGE)));
        response.end(DONE);
      },
      async (serverURL) => {
        const { events, error } = await collect(options(serverURL));
        expect(error).toBeUndefined();
        expect(textOf(events, 'content')).toBe(pieces.join(''));
      },
    );
    expect(Date.now() - started).toBeGreaterThan(IDLE);
  });

  it('reports a dropped connection after text has arrived, and does not retry', async () => {
    let hits = 0;
    await withServer(
      (_request, response) => {
        hits++;
        streamHead(response);
        response.write(sseEvent(contentChunk('Hel')));
        setTimeout(() => response.destroy(), 30);
      },
      async (serverURL) => {
        const { events, message } = await failure(options(serverURL));
        expect(message).toMatch(/^Stream failed: \S/);
        expect(message).not.toMatch(/[\r\n]/);
        expect(events).toEqual([{ kind: 'content', text: 'Hel' }]);
      },
    );
    expect(hits).toBe(1);
    expect(waits).toEqual([]);
  });

  it('retries a connection that drops before anything arrived', async () => {
    let hits = 0;
    await withServer(
      (_request, response) => {
        hits++;
        if (hits === 1) {
          response.destroy();
          return;
        }
        streamHead(response);
        response.write(sseEvent(contentChunk('ok')));
        response.write(sseEvent(usageChunk(USAGE)));
        response.end(DONE);
      },
      async (serverURL) => {
        const { events, error } = await collect(options(serverURL));
        expect(error).toBeUndefined();
        expect(textOf(events, 'content')).toBe('ok');
      },
    );
    expect(hits).toBe(2);
    expect(waits).toEqual([300]);
  });
});
