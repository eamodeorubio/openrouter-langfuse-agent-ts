import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ask } from '../src/ask.js';
import type { GenerationResult, Tracer } from '../src/tracing/tracer.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  recordedModel,
  sseBody,
  streamChunk,
  thinkingChunk,
  toolRound,
  usageChunk,
} from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const config = { apiKey: 'sk-test', model: 'req/model' };

let api: FakeApi;
beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(() => api.close());
beforeEach(() => api.reset());

/** A tracer that writes down what the loop tells it, in order. */
const recorder = () => {
  const log: unknown[] = [];
  const tracer: Tracer = {
    root: (question) => {
      log.push({ root: question });
      return {
        traceId: 'abc123',
        generation: (start) => {
          log.push({
            generation: start.requestedModel,
            roles: start.messages.map((m) => m.role),
          });
          return {
            traceparent: undefined,
            retried: () => log.push('retried'),
            firstToken: () => log.push('firstToken'),
            streamFailed: (message: string) =>
              log.push({ streamFailed: message }),
            end: (result: GenerationResult) =>
              log.push({ generationEnd: result }),
          };
        },
        tool: (call) => {
          log.push({ tool: call.name });
          return {
            traceparent: undefined,
            end: (result) => log.push({ toolEnd: result.failed }),
          };
        },
        end: (result) => log.push({ rootEnd: result }),
      };
    },
    abort: () => {},
    flush: async () => {},
  };
  return { tracer, log };
};

const drain = async (tracer: Tracer, question = 'q') => {
  const events = [];
  try {
    for await (const event of ask(config, question, {
      serverURL: api.url,
      tracer,
    })) {
      events.push(event);
    }
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
};

const USAGE = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };

describe('ask with a tracer', () => {
  it('records the root, a generation per round and a tool per call, then ends the root with the final text', async () => {
    api.reply(
      200,
      toolRound([{ id: 'c1', name: 'get_model', arguments: '{"slug":"a/b"}' }]),
    );
    api.replyGet('/model/a/b', 200, {
      data: { ...recordedModel.data, id: 'a/b' },
    });
    api.reply(200, sseBody(contentChunk('Done.'), usageChunk(USAGE)));
    const { tracer, log } = recorder();
    await drain(tracer, 'which?');
    expect(log).toEqual([
      { root: 'which?' },
      { generation: 'req/model', roles: ['system', 'user'] },
      {
        generationEnd: expect.objectContaining({
          toolCalls: [
            { id: 'c1', name: 'get_model', arguments: '{"slug":"a/b"}' },
          ],
        }),
      },
      { tool: 'get_model' },
      { toolEnd: false },
      {
        generation: 'req/model',
        roles: ['system', 'user', 'assistant', 'tool'],
      },
      'firstToken',
      {
        generationEnd: expect.objectContaining({ text: 'Done.' }),
      },
      { rootEnd: { answer: 'Done.' } },
    ]);
  });

  it('gives the generation the thinking, the served model and the finish reason', async () => {
    api.reply(
      200,
      sseBody(
        thinkingChunk('Hmm. '),
        thinkingChunk('Yes.'),
        contentChunk('A'),
        streamChunk(
          { content: '' },
          {
            choices: [
              { index: 0, delta: { content: '' }, finish_reason: 'stop' },
            ],
          },
        ),
        usageChunk(USAGE),
      ),
    );
    const { tracer, log } = recorder();
    await drain(tracer);
    expect(log).toContainEqual({
      generationEnd: expect.objectContaining({
        model: 'test/model',
        thinking: 'Hmm. Yes.',
        finishReason: 'stop',
        text: 'A',
      }),
    });
  });

  it('ends the generation and the root with the error when a request fails', async () => {
    api.reply(401, { error: { code: 401, message: 'No auth.' } });
    const { tracer, log } = recorder();
    const { error } = await drain(tracer);
    expect(error).toBeInstanceOf(Error);
    expect(log.at(-2)).toEqual({
      generationEnd: { error: expect.stringContaining('401') },
    });
    expect(log.at(-1)).toEqual({
      rootEnd: { error: expect.stringContaining('401') },
    });
  });

  it('tells the generation about each retry', async () => {
    api.reply(503, { error: { code: 503, message: 'busy' } });
    api.reply(200, sseBody(contentChunk('ok'), usageChunk(USAGE)));
    const { tracer, log } = recorder();
    await drain(tracer);
    expect(log.filter((entry) => entry === 'retried')).toHaveLength(1);
    expect(
      log.filter((e) => (e as { generation?: string }).generation),
    ).toHaveLength(1);
  });

  it('ends the root once, as interrupted, when the consumer stops reading early', async () => {
    api.reply(
      200,
      sseBody(contentChunk('A'), contentChunk('B'), usageChunk(USAGE)),
    );
    const { tracer, log } = recorder();
    const events = ask(config, 'q', { serverURL: api.url, tracer });
    await events.next(); // the trace id
    await events.next(); // the first text
    await events.return(undefined);
    const ends = log.filter((e) => (e as { rootEnd?: unknown }).rootEnd);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({
      rootEnd: { error: expect.stringMatching(/interrupted/i) },
    });
    expect(log).toContainEqual({
      generationEnd: { error: expect.stringMatching(/interrupted/i) },
    });
  });

  it('yields the trace id first, once', async () => {
    api.reply(200, sseBody(contentChunk('ok'), usageChunk(USAGE)));
    const { tracer } = recorder();
    const { events } = await drain(tracer);
    expect(events[0]).toEqual({ kind: 'trace', id: 'abc123' });
    expect(events.filter((event) => event.kind === 'trace')).toHaveLength(1);
  });

  it('yields no trace event when the run is not traced', async () => {
    api.reply(200, sseBody(contentChunk('ok'), usageChunk(USAGE)));
    const events = [];
    for await (const event of ask(config, 'q', { serverURL: api.url })) {
      events.push(event);
    }
    expect(events.some((event) => event.kind === 'trace')).toBe(false);
  });
});
