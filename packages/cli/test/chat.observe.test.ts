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
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  RECORDED_STREAM_THINKING,
  recordedCompletion,
  recordedStream,
  sseBody,
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

const roundOf = async (observer?: { retried(): void }) => {
  const gen = chat(client, request, undefined, observer);
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
    await roundOf({ retried });
    expect(retried).toHaveBeenCalledTimes(2);
  });

  it('does not tell the observer when nothing is retried', async () => {
    const retried = vi.fn();
    api.reply(200, recordedStream);
    await roundOf({ retried });
    expect(retried).not.toHaveBeenCalled();
  });
});
