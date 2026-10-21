import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chat } from '../src/chat.js';
import { createClient } from '../src/client.js';
import {
  forNock,
  RECORDED_STREAM_ANSWER,
  RECORDED_TOOL_ROUND,
  recordedCompletion,
  recordedStream,
  recordedToolStream,
} from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const PATH = '/api/v1/chat/completions';
const client = createClient('sk-test');
const request = {
  model: 'req/model',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

/** Drains the generator; gives the events it yielded and the round it returned. */
const drain = async (gen: ReturnType<typeof chat>) => {
  const events = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      return { events, round: step.value };
    }
    events.push(step.value);
  }
};

const serveStream = (body: string) =>
  nock(HOST)
    .post(PATH)
    .reply(200, forNock(body), { 'content-type': 'text/event-stream' });

describe('chat', () => {
  it('returns the tool calls and the signed reasoning of a streamed round, joined', async () => {
    serveStream(recordedToolStream);
    const { events, round } = await drain(chat(client, request));
    expect(round.toolCalls).toEqual(RECORDED_TOOL_ROUND.calls);
    expect(round.reasoningDetails).toEqual([
      expect.objectContaining({
        type: 'reasoning.text',
        text: RECORDED_TOOL_ROUND.reasoningText,
        signature: RECORDED_TOOL_ROUND.signature,
      }),
    ]);
    expect(round.text).toBe('');
    expect(round.usage?.totalTokens).toBe(
      RECORDED_TOOL_ROUND.usage?.total_tokens,
    );
    expect(events.every((event) => event.kind === 'thinking')).toBe(true);
    expect(events.map((event) => event.text).join('')).toBe(
      RECORDED_TOOL_ROUND.reasoningText,
    );
  });

  it('returns the answer text of a round without tool calls', async () => {
    serveStream(recordedStream);
    const { round } = await drain(chat(client, request));
    expect(round.text).toBe(RECORDED_STREAM_ANSWER);
    expect(round.toolCalls).toEqual([]);
  });

  it('reads tool calls and reasoning from a complete response', async () => {
    const body = structuredClone(recordedCompletion) as {
      choices: { message: Record<string, unknown> }[];
    };
    const message = body.choices[0]?.message ?? {};
    message.content = null;
    message.tool_calls = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_model', arguments: '{"slug":"a/b"}' },
      },
    ];
    message.reasoning_details = [
      { type: 'reasoning.text', text: 'whole', signature: 's', index: 0 },
    ];
    nock(HOST).post(PATH).reply(200, body);
    const { round } = await drain(chat(client, request));
    expect(round.toolCalls).toEqual([
      { id: 'call_1', name: 'get_model', arguments: '{"slug":"a/b"}' },
    ]);
    expect(round.reasoningDetails).toEqual([
      expect.objectContaining({
        type: 'reasoning.text',
        text: 'whole',
        signature: 's',
      }),
    ]);
  });

  it('reads a complete response that carries no reasoning blocks as having none', async () => {
    const body = structuredClone(recordedCompletion) as {
      choices: { message: Record<string, unknown> }[];
    };
    delete body.choices[0]?.message.reasoning_details;
    nock(HOST).post(PATH).reply(200, body);
    const { round } = await drain(chat(client, request));
    expect(round.reasoningDetails).toEqual([]);
    expect(round.text).not.toBe('');
  });

  it('keeps the blocks of a complete response apart when they carry no index', async () => {
    const body = structuredClone(recordedCompletion) as {
      choices: { message: Record<string, unknown> }[];
    };
    const message = body.choices[0]?.message ?? {};
    message.reasoning_details = [
      { type: 'reasoning.text', text: 'first', signature: 's1' },
      { type: 'reasoning.text', text: 'second', signature: 's2' },
    ];
    nock(HOST).post(PATH).reply(200, body);
    const { round } = await drain(chat(client, request));
    expect(round.reasoningDetails).toEqual([
      expect.objectContaining({ text: 'first', signature: 's1' }),
      expect.objectContaining({ text: 'second', signature: 's2' }),
    ]);
  });

  it('sends the messages, the tools and the tool choice it was given', async () => {
    let sent: Record<string, unknown> = {};
    nock(HOST)
      .post(PATH, (body) => {
        sent = body;
        return true;
      })
      .reply(200, forNock(recordedStream), {
        'content-type': 'text/event-stream',
      });
    await drain(
      chat(client, {
        ...request,
        tools: [
          {
            type: 'function',
            function: { name: 'get_model', parameters: { type: 'object' } },
          },
        ],
        toolChoice: 'none',
      }),
    );
    expect(sent).toMatchObject({
      model: 'req/model',
      stream: true,
      parallel_tool_calls: true,
      tool_choice: 'none',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'get_model' } }],
    });
  });

  it('retries a failure that comes after tool-call fragments but before any text', async () => {
    // Fragments are not text the user has seen, so a retry cannot repeat anything visible.
    const fragments = recordedToolStream
      .split('\n\n')
      .filter((e) => e.includes('tool_calls') && !e.includes('reasoning'))
      .slice(0, 2)
      .join('\n\n');
    nock(HOST)
      .post(PATH)
      .reply(
        200,
        `${fragments}\n\ndata: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"error":{"code":503,"message":"busy"}}\n\n`,
        {
          'content-type': 'text/event-stream',
        },
      );
    serveStream(recordedStream);
    const { round } = await drain(chat(client, request));
    expect(round.text).toBe(RECORDED_STREAM_ANSWER);
  });
});
