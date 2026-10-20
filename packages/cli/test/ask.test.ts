import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fc from 'fast-check';
import nock from 'nock';
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
import {
  RECORDED_401_MESSAGE,
  RECORDED_ANSWER,
  RECORDED_MODEL,
  RECORDED_USAGE,
  recordedCompletion,
  recordedUnauthorized,
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

const body = (overrides: Record<string, unknown> = {}) => ({
  ...recordedCompletion,
  ...overrides,
});

const attempts = { count: 0 };
const counted = (scope: nock.Scope) =>
  scope.post(PATH, () => {
    attempts.count++;
    return true;
  });

type Step = [status: number, payload: nock.Body];

/** Answers the first request with the first step, the second with the second, and so on. */
const serve = (...steps: Step[]) => {
  for (const [status, payload] of steps) {
    counted(nock(HOST)).reply(status, payload);
  }
};

/** Answers every request the same way. */
const serveAlways = (status: number, payload: nock.Body) =>
  counted(nock(HOST).persist()).reply(status, payload);

const reply = (status: number, payload: nock.Body) => serve([status, payload]);

const failure = async (options?: AskOptions): Promise<ApiError> => {
  const error = await ask(config, 'hi', options).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
beforeEach(() => {
  waits.length = 0;
  attempts.count = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  nock.cleanAll();
});

describe('ask', () => {
  it('sends the model, the question and the key, and returns the answer, served model and usage', async () => {
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
      .reply(200, body());
    const answer = await ask(config, 'What is a token?');
    expect(sent).toMatchObject({
      model: 'req/model',
      messages: [{ role: 'user', content: 'What is a token?' }],
    });
    expect(authorization).toBe('Bearer sk-test');
    expect(answer).toEqual({
      text: RECORDED_ANSWER,
      model: RECORDED_MODEL,
      usage: RECORDED_USAGE,
    });
  });

  it('accepts zero token counts', async () => {
    reply(
      200,
      body({
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
    expect((await ask(config, 'hi')).usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('cuts a long server message to 200 characters and marks the cut', async () => {
    serveAlways(500, { error: { code: 500, message: 'x'.repeat(1000) } });
    const { message } = await failure();
    expect(message).toBe(`API error 500: ${'x'.repeat(200)}…`);
  });

  it('turns an HTTP error into an ApiError with the status and the API message', async () => {
    reply(401, recordedUnauthorized as nock.Body);
    expect((await failure()).message).toBe(
      `API error 401: ${RECORDED_401_MESSAGE}`,
    );
  });

  it('turns a plain-text server error into an ApiError with the status', async () => {
    serveAlways(500, 'upstream exploded' as unknown as nock.Body);
    expect((await failure()).message).toMatch(/^API error 500: /);
  });

  it('turns a request that never gets an answer into a timeout ApiError', async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    nock.enableNetConnect('127.0.0.1');
    try {
      const { port } = server.address() as AddressInfo;
      const error = await failure({
        timeoutMs: 200,
        serverURL: `http://127.0.0.1:${port}/api/v1`,
      });
      expect(error.message).toMatch(/^Request failed: Request timed out/);
      expect(waits).toEqual([]);
    } finally {
      server.closeAllConnections();
      server.close();
      nock.disableNetConnect();
    }
  });

  it('turns a network error into an ApiError', async () => {
    nock(HOST).persist().post(PATH).replyWithError('socket hang up');
    expect((await failure()).message).toMatch(/^Request failed: /);
  });

  it('turns a body the SDK cannot parse into an ApiError without the validation dump', async () => {
    reply(200, { error: { code: 502, message: 'provider down' } });
    const { message } = await failure();
    expect(message).toBe('The API response did not have the expected shape.');
  });

  it.each([
    ['no choices', { choices: [] }, /no answer/i],
    [
      'null content',
      {
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: null },
          },
        ],
      },
      /no answer/i,
    ],
    [
      'empty content',
      {
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
      },
      /no answer/i,
    ],
    ['no usage', { usage: undefined }, /token usage/i],
    [
      'partial usage',
      { usage: { prompt_tokens: 1 } },
      /token usage|expected shape/i,
    ],
  ])('rejects a response with %s', async (_name, overrides, message) => {
    reply(200, body(overrides));
    expect((await failure()).message).toMatch(message);
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

describe('retries', () => {
  const busy = (status: number): Step => [
    status,
    { error: { code: status, message: 'busy' } },
  ];

  it.each([429, 500, 502, 503, 504])(
    'retries HTTP %i once and returns the later answer',
    async (status) => {
      serve(busy(status), [200, body()]);
      expect((await ask(config, 'hi')).text).toBe(RECORDED_ANSWER);
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
    serve([200, body()]);
    expect((await ask(config, 'hi')).text).toBe(RECORDED_ANSWER);
    expect(waits).toEqual([300]);
  });

  it('does not retry a response without an answer', async () => {
    serve([200, body({ choices: [] })], [200, body()]);
    await failure();
    expect(attempts.count).toBe(1);
    expect(waits).toEqual([]);
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
