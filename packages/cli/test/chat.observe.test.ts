import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { chat } from '../src/chat.js';
import { createClient } from '../src/client.js';
import { ApiError } from '../src/errors.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  errorChunk,
  RECORDED_STREAM_THINKING,
  recordedCompletion,
  recordedStream,
  sseBody,
  thinkingChunk,
  toolRound,
  usageChunk,
} from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

// What a round reports besides its text: thinking, finish reason, retries.
// Real loopback server, because it lets a stream end the way production's does.
let api: FakeApi;
let client: ReturnType<typeof createClient>;
const request = {
  model: 'req/model',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

beforeAll(async () => {
  api = await startFakeApi();
  client = createClient('sk-test', api.url);
});
afterAll(() => api.close());
beforeEach(() => api.reset());

interface Watcher {
  traceparent?: string | undefined;
  retried(): void;
  firstToken(): void;
  streamFailed(message: string): void;
}

const watcher = () => ({
  retried: vi.fn(),
  firstToken: vi.fn(),
  streamFailed: vi.fn(),
});

const roundOf = async (observer?: Partial<Watcher>, idleTimeoutMs?: number) => {
  const gen = chat(client, request, idleTimeoutMs, observer as Watcher);
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      return step.value;
    }
  }
};

describe('chat round details', () => {
  it('returns the joined thinking text and the finish reason of a streamed round', async () => {
    api.reply(200, recordedStream);
    const round = await roundOf();
    expect(round.thinking).toBe(RECORDED_STREAM_THINKING);
    expect(round.finishReason).toBe('stop');
  });

  it('carries the cost, the cached tokens and the reasoning tokens the API reports', async () => {
    api.reply(200, recordedStream);
    expect((await roundOf()).usage).toEqual({
      promptTokens: 25,
      completionTokens: 122,
      totalTokens: 147,
      reasoningTokens: 128,
      cachedTokens: 0,
      cost: 0,
    });
  });

  it('leaves the cost and the cached tokens out when the API reports none', async () => {
    api.reply(200, sseBody(contentChunk('Hi.'), usageChunk()));
    const usage = (await roundOf()).usage;
    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    });
  });

  it('gives the finish reason the API sent, and no thinking when there was none', async () => {
    api.reply(
      200,
      sseBody(contentChunk('Hi.'), usageChunk()).replace(
        '"finish_reason":null',
        '"finish_reason":"tool_calls"',
      ),
    );
    const round = await roundOf();
    expect(round.finishReason).toBe('tool_calls');
    expect(round.thinking).toBe('');
  });

  it('gives the finish reason of a complete response', async () => {
    api.reply(200, recordedCompletion);
    expect((await roundOf()).finishReason).toBe('stop');
  });

  it('tells the observer about each retry', async () => {
    const retried = vi.fn();
    api.reply(503, { error: { code: 503, message: 'busy' } });
    api.reply(503, { error: { code: 503, message: 'busy' } });
    api.reply(200, recordedStream);
    await roundOf({ ...watcher(), retried });
    expect(retried).toHaveBeenCalledTimes(2);
  });

  it('does not tell the observer when nothing is retried', async () => {
    const retried = vi.fn();
    api.reply(200, recordedStream);
    await roundOf({ ...watcher(), retried });
    expect(retried).not.toHaveBeenCalled();
  });

  describe('the trace context', () => {
    const header = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

    it('is sent as traceparent when the observer has one, on every attempt', async () => {
      api.reply(503, { error: { code: 503, message: 'busy' } });
      api.reply(200, recordedStream);
      await roundOf({ ...watcher(), traceparent: header });
      expect(api.sent.map((sent) => sent.traceparent)).toEqual([
        header,
        header,
      ]);
    });

    it('is not sent when the observer has none', async () => {
      api.reply(200, recordedStream);
      await roundOf(watcher());
      expect(api.sent.map((sent) => sent.traceparent)).toEqual([undefined]);
    });
  });

  describe('the first token', () => {
    it('is announced once, however many chunks follow', async () => {
      const observer = watcher();
      api.reply(
        200,
        sseBody(
          contentChunk('a'),
          contentChunk('b'),
          contentChunk('c'),
          usageChunk(),
        ),
      );
      await roundOf(observer);
      expect(observer.firstToken).toHaveBeenCalledTimes(1);
    });

    it('is announced by thinking as well as by text', async () => {
      const observer = watcher();
      api.reply(200, sseBody(thinkingChunk('hm'), usageChunk()));
      await roundOf(observer);
      expect(observer.firstToken).toHaveBeenCalledTimes(1);
    });

    it('is not announced by a round that holds only tool calls', async () => {
      const observer = watcher();
      api.reply(
        200,
        toolRound([
          { id: 'c1', name: 'get_model', arguments: '{"slug":"a/b"}' },
        ]),
      );
      await roundOf(observer);
      expect(observer.firstToken).not.toHaveBeenCalled();
    });

    it('is announced once when a failed attempt is retried before any output', async () => {
      const observer = watcher();
      api.reply(503, { error: { code: 503, message: 'busy' } });
      api.reply(200, sseBody(contentChunk('a'), usageChunk()));
      await roundOf(observer);
      expect(observer.firstToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('a stream that fails', () => {
    it('is reported when the stream breaks halfway', async () => {
      const observer = watcher();
      const pass = api.open();
      pass.write(`data: ${JSON.stringify(contentChunk('a'))}\n\n`);
      const failing = expect(roundOf(observer)).rejects.toThrow();
      await vi.waitFor(() => expect(observer.firstToken).toHaveBeenCalled());
      pass.destroy(new Error('connection reset'));
      await failing;
      expect(observer.streamFailed).toHaveBeenCalledTimes(1);
      expect(observer.streamFailed.mock.calls[0]?.[0]).toEqual(
        expect.any(String),
      );
    });

    it('is reported when the stream goes idle', async () => {
      const observer = watcher();
      const pass = api.open();
      pass.write(`data: ${JSON.stringify(contentChunk('a'))}\n\n`);
      await expect(roundOf(observer, 30)).rejects.toThrow();
      expect(observer.streamFailed).toHaveBeenCalledTimes(1);
      pass.destroy();
    });

    it('is reported when a chunk carries an error', async () => {
      const observer = watcher();
      api.reply(
        200,
        sseBody(contentChunk('a'), errorChunk(500, 'provider fell over')),
      );
      await expect(roundOf(observer)).rejects.toThrow();
      expect(observer.streamFailed).toHaveBeenCalledTimes(1);
      expect(observer.streamFailed.mock.calls[0]?.[0]).toContain(
        'provider fell over',
      );
    });

    it('still ends in the same error when nobody is watching', async () => {
      const pass = api.open();
      pass.write(`data: ${JSON.stringify(contentChunk('a'))}\n\n`);
      await expect(roundOf(undefined, 30)).rejects.toThrow(ApiError);
      pass.destroy();
    });

    it('is not reported for an attempt that is retried', async () => {
      const observer = watcher();
      api.reply(200, sseBody(errorChunk(503, 'busy')));
      api.reply(200, sseBody(contentChunk('a'), usageChunk()));
      await roundOf(observer);
      expect(observer.streamFailed).not.toHaveBeenCalled();
    });

    it('is not reported for a refusal that came before any stream', async () => {
      const observer = watcher();
      api.reply(401, { error: { code: 401, message: 'No auth.' } });
      await expect(roundOf(observer)).rejects.toThrow();
      expect(observer.streamFailed).not.toHaveBeenCalled();
    });
  });
});
