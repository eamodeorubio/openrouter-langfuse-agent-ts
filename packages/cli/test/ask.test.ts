import fc from 'fast-check';
import nock from 'nock';
import {
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
import {
  contentChunk,
  forNock,
  RECORDED_401_MESSAGE,
  recordedUnauthorized,
  sseBody,
  usageChunk,
} from './fixtures.js';

const waits = vi.hoisted(() => [] as number[]);
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    waits.push(ms);
  },
}));

const HOST = 'https://openrouter.ai';
const PATH = '/api/v1/chat/completions';
const config = { apiKey: 'sk-test', model: 'req/model' };
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };

const good = sseBody(contentChunk('42'), usageChunk(USAGE));

const attempts = { count: 0 };
const counted = (scope: nock.Scope) =>
  scope.post(PATH, () => {
    attempts.count++;
    return true;
  });

type Step = [status: number, payload: nock.Body];

const headersFor = (status: number, payload: unknown) =>
  status === 200 && typeof payload === 'string'
    ? { 'content-type': 'text/event-stream' }
    : undefined;

const bodyFor = (status: number, payload: nock.Body): nock.Body =>
  status === 200 && typeof payload === 'string' ? forNock(payload) : payload;

/** Answers the first request with the first step, the second with the second, and so on. */
const serve = (...steps: Step[]) => {
  for (const [status, payload] of steps) {
    counted(nock(HOST)).reply(
      status,
      bodyFor(status, payload),
      headersFor(status, payload),
    );
  }
};

/** Answers every request the same way. */
const serveAlways = (status: number, payload: nock.Body) =>
  counted(nock(HOST).persist()).reply(
    status,
    bodyFor(status, payload),
    headersFor(status, payload),
  );

const reply = (status: number, payload: nock.Body) => serve([status, payload]);

/** Runs `ask` to the end, keeping the events that came before any failure. */
const collect = async (options?: AskOptions) => {
  const events: AskEvent[] = [];
  let error: unknown;
  try {
    for await (const event of ask(config, 'hi', options)) {
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

beforeAll(() => nock.disableNetConnect());
beforeEach(() => {
  waits.length = 0;
  attempts.count = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  nock.cleanAll();
});

describe('ask: the request', () => {
  it('sends the model, the question, the key and a streaming flag', async () => {
    let sent: unknown;
    let authorization: string | undefined;
    nock(HOST, {
      reqheaders: {
        authorization: (value) => {
          authorization = value ?? undefined;
          return true;
        },
      },
    })
      .post(PATH, (requestBody) => {
        sent = requestBody;
        return true;
      })
      .reply(200, forNock(good), { 'content-type': 'text/event-stream' });
    await collect();
    expect(sent).toMatchObject({
      model: 'req/model',
      stream: true,
      messages: [
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'hi' },
      ],
    });
    expect(authorization).toBe('Bearer sk-test');
  });
});

describe('ask: HTTP and network failures', () => {
  it('turns an HTTP error into an ApiError with the status and the API message', async () => {
    reply(401, recordedUnauthorized as nock.Body);
    expect((await failure()).message).toBe(
      `API error 401: ${RECORDED_401_MESSAGE}`,
    );
  });

  it('cuts a long server message to 200 characters and marks the cut', async () => {
    serveAlways(500, { error: { code: 500, message: 'x'.repeat(1000) } });
    expect((await failure()).message).toBe(
      `API error 500: ${'x'.repeat(200)}…`,
    );
  });

  it('collapses runs of whitespace in the API message and trims its ends', async () => {
    serveAlways(500, {
      error: { code: 500, message: '  one\n\n  two   three\t ' },
    });
    expect((await failure()).message).toBe('API error 500: one two three');
  });

  it.each([
    ['exactly 200 characters is kept whole', 200, 'x'.repeat(200)],
    ['201 characters is cut to 200 and marked', 201, `${'x'.repeat(200)}…`],
  ])('a message of %s', async (_name, length, expected) => {
    serveAlways(500, { error: { code: 500, message: 'x'.repeat(length) } });
    expect((await failure()).message).toBe(`API error 500: ${expected}`);
  });

  it('turns a plain-text server error into an ApiError with the status', async () => {
    serveAlways(500, 'upstream exploded' as unknown as nock.Body);
    expect((await failure()).message).toMatch(/^API error 500: /);
  });

  it('turns a network error into an ApiError', async () => {
    nock(HOST).persist().post(PATH).replyWithError('socket hang up');
    expect((await failure()).message).toMatch(/^Request failed: /);
  });

  it('keeps every failure message on one line, whatever the server sends', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.constantFrom(400, 401, 404, 429, 500, 503),
        async (text, status) => {
          serveAlways(status, text);
          try {
            const { message } = await failure();
            expect(message).not.toMatch(/[\r\n]/);
            expect(message.length).toBeLessThanOrEqual(300);
          } finally {
            nock.cleanAll();
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('ask: retries', () => {
  const busy = (status: number): Step => [
    status,
    { error: { code: status, message: 'busy' } },
  ];

  it.each([429, 500, 502, 503, 504])(
    'retries HTTP %i once and returns the later answer',
    async (status) => {
      serve(busy(status), [200, good]);
      const { events, error } = await collect();
      expect(error).toBeUndefined();
      expect(textOf(events, 'content')).toBe('42');
      expect(attempts.count).toBe(2);
      expect(waits).toEqual([300]);
    },
  );

  it.each([400, 401, 402, 403, 404])(
    'does not retry HTTP %i',
    async (status) => {
      serveAlways(status, { error: { code: status, message: 'no' } });
      expect((await failure()).message).toBe(`API error ${status}: no`);
      expect(attempts.count).toBe(1);
      expect(waits).toEqual([]);
    },
  );

  it('gives up after four retries and reports the last error', async () => {
    serveAlways(503, { error: { code: 503, message: 'overloaded' } });
    expect((await failure()).message).toBe('API error 503: overloaded');
    expect(attempts.count).toBe(5);
    expect(waits).toEqual([300, 600, 1200, 2400]);
  });

  it('reports the last error, not the first', async () => {
    serve(busy(503), busy(503), busy(503), busy(503), [
      500,
      { error: { code: 500, message: 'last' } },
    ]);
    expect((await failure()).message).toBe('API error 500: last');
  });

  it('retries a connection error', async () => {
    nock(HOST).post(PATH).replyWithError('socket hang up');
    serve([200, good]);
    const { events, error } = await collect();
    expect(error).toBeUndefined();
    expect(textOf(events, 'content')).toBe('42');
    expect(waits).toEqual([300]);
  });

  it('waits 300 ms doubling each time, scaled by 0.75 to 1.25, for any jitter draw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        async (draw) => {
          waits.length = 0;
          vi.spyOn(Math, 'random').mockReturnValue(draw);
          serveAlways(503, { error: { code: 503, message: 'busy' } });
          try {
            await failure();
            expect(waits).toHaveLength(4);
            waits.forEach((wait, retry) => {
              const base = 300 * 2 ** retry;
              expect(wait).toBeCloseTo(base * (0.75 + draw * 0.5), 6);
              expect(wait).toBeGreaterThanOrEqual(base * 0.75);
              expect(wait).toBeLessThanOrEqual(base * 1.25);
            });
          } finally {
            nock.cleanAll();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
