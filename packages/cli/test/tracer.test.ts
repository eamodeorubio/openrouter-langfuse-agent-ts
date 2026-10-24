import { homedir, hostname } from 'node:os';
import {
  InMemorySpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/errors.js';
import { createLangfuseTracer } from '../src/tracing/langfuse.js';
import { INTERRUPTED, NO_TRACER, type Tracer } from '../src/tracing/tracer.js';

const config = {
  publicKey: 'pk-lf-AAA',
  secretKey: 'sk-lf-BBB',
  baseUrl: 'http://127.0.0.1:9',
};

let exporter: InMemorySpanExporter;
let tracer: Tracer;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  tracer = createLangfuseTracer({
    config,
    exporter,
    secrets: ['sk-or-OPENROUTER', config.publicKey, config.secretKey],
    version: '1.2.3',
  });
});

const span = async (name: string, nth = 0): Promise<ReadableSpan> => {
  await tracer.flush();
  const found = exporter.getFinishedSpans().filter((s) => s.name === name)[nth];
  if (!found) {
    throw new Error(`no span ${name}`);
  }
  return found;
};

/** A string input or output is stored as it is; anything else as JSON. */
const json = (s: ReadableSpan, key: string): unknown => {
  const raw = s.attributes[key];
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};

const text = (s: ReadableSpan, key: string): unknown => s.attributes[key];

const input = (s: ReadableSpan) => text(s, 'langfuse.observation.input');
const output = (s: ReadableSpan) => text(s, 'langfuse.observation.output');
const inputJson = (s: ReadableSpan) => json(s, 'langfuse.observation.input');
const outputJson = (s: ReadableSpan) => json(s, 'langfuse.observation.output');

const messages = [
  { role: 'system' as const, content: 'Be brief.' },
  { role: 'user' as const, content: 'Which is cheaper?' },
];

describe('what every observation carries', () => {
  const everything = async () => {
    const root = tracer.root('q');
    const generation = root.generation({ requestedModel: 'm', messages });
    generation.firstToken();
    generation.end({ model: 'm', text: 'a' });
    root.tool({ name: 'calculate', arguments: '{}' }).end({
      output: '1',
      failed: false,
    });
    root.end({ answer: 'a' });
    await tracer.flush();
    return exporter.getFinishedSpans();
  };

  it('stamps the version on the root, the generation, the tool and the event', async () => {
    const spans = await everything();
    expect(spans.map((s) => s.name).sort()).toEqual([
      'answer-question',
      'calculate',
      'generate-response',
      'receive-first-token',
    ]);
    for (const s of spans) {
      expect(s.attributes['langfuse.version']).toBe('1.2.3');
    }
  });

  it('stamps the version on an observation that was aborted', async () => {
    tracer.root('q').generation({ requestedModel: 'm', messages });
    tracer.abort('x');
    await tracer.flush();
    for (const s of exporter.getFinishedSpans()) {
      expect(s.attributes['langfuse.version']).toBe('1.2.3');
    }
  });

  it('puts the environment and the release on every observation, with defaults', async () => {
    for (const s of await everything()) {
      expect(s.attributes['langfuse.environment']).toBe('default');
      expect(s.attributes['langfuse.release']).toBe('1.2.3');
    }
  });

  it('uses the environment and the release it is given', async () => {
    exporter.reset();
    tracer = createLangfuseTracer({
      config,
      exporter,
      secrets: [],
      version: '1.2.3',
      environment: 'staging',
      release: 'abc123',
    });
    for (const s of await everything()) {
      expect(s.attributes['langfuse.environment']).toBe('staging');
      expect(s.attributes['langfuse.release']).toBe('abc123');
    }
  });

  it('names the service and says nothing about this machine', async () => {
    const spans = await everything();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.resource.attributes['service.name']).toBe(
        'openrouter-langfuse-agent-ts',
      );
      expect(s.resource.attributes['service.version']).toBe('1.2.3');
      const resource = JSON.stringify(s.resource.attributes);
      // A needle of a few characters, such as `/` for a home directory, would match anything.
      const needles = [process.execPath, homedir(), hostname()].filter(
        (needle) => needle.length >= 4,
      );
      expect(needles).toContain(process.execPath);
      for (const private_ of needles) {
        expect(resource).not.toContain(private_);
      }
    }
  });

  it('carries no session id and no user id', async () => {
    for (const s of await everything()) {
      expect(Object.keys(s.attributes).join(' ')).not.toMatch(/session|user/);
    }
  });
});

describe('the trace id and the trace context', () => {
  it('gives the trace id of the exported spans, 32 hex characters', async () => {
    const root = tracer.root('q');
    root.end({ answer: 'a' });
    const s = await span('answer-question');
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root.traceId).toBe(s.spanContext().traceId);
  });

  it('gives each generation and tool a traceparent of its own span, with the sampled flag', async () => {
    const root = tracer.root('q');
    const generation = root.generation({ requestedModel: 'm', messages });
    const tool = root.tool({ name: 'calculate', arguments: '{}' });
    generation.end({ model: 'm', text: 'a' });
    tool.end({ output: '1', failed: false });
    root.end({ answer: 'a' });
    const g = await span('generate-response');
    const t = await span('calculate');
    expect(generation.traceparent).toBe(
      `00-${root.traceId}-${g.spanContext().spanId}-01`,
    );
    expect(tool.traceparent).toBe(
      `00-${root.traceId}-${t.spanContext().spanId}-01`,
    );
    expect(generation.traceparent).not.toBe(tool.traceparent);
  });

  it('gives no traceparent and no trace id after an abort, or from the no-op tracer', () => {
    const root = tracer.root('q');
    tracer.abort(INTERRUPTED);
    const late = root.generation({ requestedModel: 'm', messages });
    expect(late.traceparent).toBeUndefined();
    const none = NO_TRACER.root('q');
    expect(none.traceId).toBeUndefined();
    expect(
      none.generation({ requestedModel: 'm', messages }).traceparent,
    ).toBeUndefined();
    expect(
      none.tool({ name: 't', arguments: '{}' }).traceparent,
    ).toBeUndefined();
  });
});

describe('the root', () => {
  it('is an agent holding the question, then the answer', async () => {
    const root = tracer.root('Which is cheaper?');
    root.end({ answer: 'Model X.' });
    const s = await span('answer-question');
    expect(s.attributes['langfuse.observation.type']).toBe('agent');
    expect(input(s)).toBe('Which is cheaper?');
    expect(output(s)).toBe('Model X.');
    expect(s.attributes['langfuse.observation.level']).toBeUndefined();
  });

  it('is an error with the one-line message when the run fails', async () => {
    tracer.root('q').end({ error: 'The API answered 500.' });
    const s = await span('answer-question');
    expect(s.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(s.attributes['langfuse.observation.status_message']).toBe(
      'The API answered 500.',
    );
    expect(output(s)).toBeUndefined();
  });
});

describe('the names of the observations', () => {
  const namesOf = async () => {
    await tracer.flush();
    return exporter
      .getFinishedSpans()
      .map((s) => s.name)
      .sort();
  };

  it.each([
    ['openai/gpt-oss-20b', 'openai/gpt-oss-20b-2026-01'],
    ['anthropic/claude-haiku', 'anthropic/claude-haiku-4.5'],
  ])(
    'do not hold the model, asked for as %s or answered by %s',
    async (requested, served) => {
      const root = tracer.root('q');
      root
        .generation({ requestedModel: requested, messages })
        .end({ model: served, text: 'a' });
      root.end({ answer: 'a' });
      expect(await namesOf()).toEqual(['answer-question', 'generate-response']);
    },
  );

  it('do not hold the question, the number of a round or an id, whatever the run holds', async () => {
    const root = tracer.root('what does gpt-4o cost? 0123456789abcdef');
    root.generation({ requestedModel: 'm', messages }).end({ model: 'm' });
    root.tool({ name: 'get_model', arguments: '{}' }).end({
      output: '{}',
      failed: false,
    });
    root.generation({ requestedModel: 'm', messages }).end({ model: 'm' });
    root.tool({ name: 'calculate', arguments: '{}' }).end({
      output: '1',
      failed: false,
    });
    root.end({ answer: 'a' });
    expect(await namesOf()).toEqual([
      'answer-question',
      'calculate',
      'generate-response',
      'generate-response',
      'get_model',
    ]);
  });
});

describe('a generation', () => {
  it('is named generate-response under the root and sends the messages in OpenAI shape', async () => {
    const root = tracer.root('q');
    const generation = root.generation({
      requestedModel: 'req/model',
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_model', arguments: '{"slug":"a/b"}' },
            },
          ],
        },
        { role: 'tool', toolCallId: 'call_1', content: '{"id":"a/b"}' },
      ],
    });
    generation.end({});
    root.end({ answer: 'a' });
    const g = await span('generate-response');
    const r = await span('answer-question');
    expect(g.attributes['langfuse.observation.type']).toBe('generation');
    expect(g.parentSpanContext?.spanId).toBe(r.spanContext().spanId);
    expect(inputJson(g)).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Which is cheaper?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_model', arguments: '{"slug":"a/b"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"id":"a/b"}' },
    ]);
  });

  it('records the model that served it, and the one that was asked for', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'req/model', messages });
    generation.end({ model: 'served/model-2026' });
    const g = await span('generate-response');
    expect(g.attributes['langfuse.observation.model.name']).toBe(
      'served/model-2026',
    );
    expect(json(g, 'langfuse.observation.metadata.requested_model')).toBe(
      'req/model',
    );
  });

  it('falls back to the requested model when the request failed before a model answered', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'req/model', messages })
      .end({ error: 'HTTP 503' });
    const g = await span('generate-response');
    expect(g.attributes['langfuse.observation.model.name']).toBe('req/model');
  });

  it('holds the reply as an assistant message with its text, tool calls and thinking, and the finish reason', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({
        model: 'm',
        text: 'Checking.',
        thinking: 'Let me look.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'calculate', arguments: '{"x":1}' }],
      });
    const g = await span('generate-response');
    expect(outputJson(g)).toEqual({
      role: 'assistant',
      content: 'Checking.',
      reasoning: 'Let me look.',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'calculate', arguments: '{"x":1}' },
        },
      ],
    });
    expect(json(g, 'langfuse.observation.metadata.finish_reason')).toBe(
      'tool_calls',
    );
  });

  it('holds the buckets and the cost, and the odd counts in the metadata', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({
        model: 'm',
        text: 'a',
        usage: {
          promptTokens: 25,
          completionTokens: 122,
          totalTokens: 147,
          reasoningTokens: 128,
          cost: 0.0021,
        },
      });
    const g = await span('generate-response');
    expect(json(g, 'langfuse.observation.usage_details')).toEqual({
      input: 25,
      output: 122,
      total: 147,
    });
    expect(json(g, 'langfuse.observation.cost_details')).toEqual({
      total: 0.0021,
    });
    expect(json(g, 'langfuse.observation.metadata.reasoning_tokens')).toBe(128);
  });

  it('gives no usage and no cost when the API reported none', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({ model: 'm', text: 'a' });
    const g = await span('generate-response');
    expect(g.attributes['langfuse.observation.usage_details']).toBeUndefined();
    expect(g.attributes['langfuse.observation.cost_details']).toBeUndefined();
  });

  it('gives no cost when the cost is not a number', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({
        model: 'm',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.cost_details'
      ],
    ).toBeUndefined();
  });

  it('leaves the content null and the lists out when there is nothing to put in them', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({ model: 'm', text: '', toolCalls: [] });
    expect(outputJson(await span('generate-response'))).toEqual({
      role: 'assistant',
      content: null,
    });
  });

  it('is an error with the message when the request failed, and has no output', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({ error: 'The API answered 503.' });
    const g = await span('generate-response');
    expect(g.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(g.attributes['langfuse.observation.status_message']).toBe(
      'The API answered 503.',
    );
    expect(output(g)).toBeUndefined();
  });

  it('counts its retries in the metadata, and makes no second generation', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.retried();
    generation.end({ model: 'm', text: 'ok' });
    await tracer.flush();
    expect(
      exporter.getFinishedSpans().filter((s) => s.name === 'generate-response'),
    ).toHaveLength(1);
    expect(
      json(
        await span('generate-response'),
        'langfuse.observation.metadata.retries',
      ),
    ).toBe(1);
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.level'
      ],
    ).toBeUndefined();
  });

  it('counts its retries in the metadata when the request fails in the end', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.retried();
    generation.retried();
    generation.end({ error: 'The API answered 503.' });
    const g = await span('generate-response');
    expect(json(g, 'langfuse.observation.metadata.retries')).toBe(2);
    expect(g.attributes['langfuse.observation.level']).toBe('ERROR');
  });

  it('records no retries when there were none', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({ model: 'm', text: 'ok' });
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.metadata.retries'
      ],
    ).toBeUndefined();
  });
});

describe('the time to first token', () => {
  it('sets the completion start time of the generation to the moment of the first token', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.firstToken();
    generation.end({ model: 'm', text: 'a' });
    await tracer.flush();
    const g = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'generate-response');
    const event = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'receive-first-token');
    const started = event?.startTime ?? [0, 0];
    const expected = new Date(started[0] * 1000 + started[1] / 1e6);
    const actual = new Date(
      json(
        g as ReadableSpan,
        'langfuse.observation.completion_start_time',
      ) as string,
    );
    expect(Number.isNaN(actual.getTime())).toBe(false);
    // The same instant, to the millisecond.
    expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(1);
  });

  it('leaves it unset for a generation that never got a token', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .end({ model: 'm', text: '' });
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.completion_start_time'
      ],
    ).toBeUndefined();
  });

  it('is not set by a failed stream, which is no token', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.streamFailed('The stream broke.');
    generation.end({ error: 'The stream broke.' });
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.completion_start_time'
      ],
    ).toBeUndefined();
  });

  it('keeps the first moment when told twice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      const generation = tracer
        .root('q')
        .generation({ requestedModel: 'm', messages });
      generation.firstToken();
      vi.setSystemTime(new Date('2030-01-01T00:00:05.000Z'));
      generation.firstToken();
      generation.end({ model: 'm', text: 'a' });
    } finally {
      vi.useRealTimers();
    }
    expect(
      json(
        await span('generate-response'),
        'langfuse.observation.completion_start_time',
      ),
    ).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('the events of a stream', () => {
  const eventsOf = async (name: string) => {
    await tracer.flush();
    return exporter.getFinishedSpans().filter((s) => s.name === name);
  };

  it('has one receive-first-token event under the generation, however often it is told', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.firstToken();
    generation.firstToken();
    generation.end({ model: 'm', text: 'a' });
    const events = await eventsOf('receive-first-token');
    const g = await span('generate-response');
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes['langfuse.observation.type']).toBe('event');
    expect(events[0]?.parentSpanContext?.spanId).toBe(g.spanContext().spanId);
  });

  it('has one fail-stream event with the reason, as an error, however often it is told', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.streamFailed('The stream broke: reset.');
    generation.streamFailed('again');
    generation.end({ error: 'The stream broke: reset.' });
    const events = await eventsOf('fail-stream');
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(events[0]?.attributes['langfuse.observation.status_message']).toBe(
      'The stream broke: reset.',
    );
  });

  it('hides a key in the reason of a failed stream', async () => {
    tracer
      .root('q')
      .generation({ requestedModel: 'm', messages })
      .streamFailed('broke at sk-or-OPENROUTER');
    const [event] = await eventsOf('fail-stream');
    expect(
      event?.attributes['langfuse.observation.status_message'],
    ).not.toContain('sk-or-OPENROUTER');
  });

  it('makes no event once the generation has ended', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages });
    generation.end({ model: 'm', text: 'a' });
    generation.firstToken();
    generation.streamFailed('late');
    expect(await eventsOf('receive-first-token')).toHaveLength(0);
    expect(await eventsOf('fail-stream')).toHaveLength(0);
  });
});

describe('a tool call', () => {
  it('is a tool named after the tool, under the root, holding the arguments and the result', async () => {
    const root = tracer.root('q');
    const tool = root.tool({ name: 'get_model', arguments: '{"slug":"a/b"}' });
    tool.end({ output: '{"id":"a/b"}', failed: false });
    root.end({ answer: 'a' });
    const t = await span('get_model');
    const r = await span('answer-question');
    expect(t.attributes['langfuse.observation.type']).toBe('tool');
    expect(t.parentSpanContext?.spanId).toBe(r.spanContext().spanId);
    expect(inputJson(t)).toEqual({ slug: 'a/b' });
    expect(output(t)).toBe('{"id":"a/b"}');
    expect(t.attributes['langfuse.observation.level']).toBeUndefined();
  });

  it('keeps arguments that are not JSON as the text the model sent', async () => {
    tracer.root('q').tool({ name: 'calculate', arguments: '{oops' }).end({
      output: '{"error":"bad"}',
      failed: true,
    });
    expect(input(await span('calculate'))).toBe('{oops');
  });

  it('is an error, with the reason as status message, when the call failed', async () => {
    tracer
      .root('q')
      .tool({ name: 'calculate', arguments: '{}' })
      .end({ output: '{"error":"Division by zero."}', failed: true });
    const t = await span('calculate');
    expect(t.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(t.attributes['langfuse.observation.status_message']).toBe(
      'Division by zero.',
    );
    expect(output(t)).toBe('{"error":"Division by zero."}');
  });
});

describe('keeping keys out', () => {
  it('replaces every key in the input, the output and the status message', async () => {
    const root = tracer.root('my key is sk-or-OPENROUTER');
    const generation = root.generation({
      requestedModel: 'm',
      messages: [{ role: 'user', content: 'see sk-lf-BBB and pk-lf-AAA' }],
    });
    generation.end({ error: 'failed with sk-or-OPENROUTER' });
    root.tool({ name: 'calculate', arguments: '{}' }).end({
      output: '{"error":"sk-or-OPENROUTER"}',
      failed: true,
    });
    root.end({ answer: 'sk-lf-BBB' });
    await tracer.flush();
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((s) => s.attributes),
    );
    for (const secret of ['sk-or-OPENROUTER', 'sk-lf-BBB', 'pk-lf-AAA']) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).toContain('[REDACTED]');
  });
});

describe('a tool failure, as the model is told of it', () => {
  it.each([
    ['null', 'null'],
    ['an error that is not text', '{"error":5}'],
    ['plain text', 'exploded'],
  ])(
    'uses the whole result as the reason when it holds %s',
    async (_n, out) => {
      tracer.root('q').tool({ name: 'calculate', arguments: '{}' }).end({
        output: out,
        failed: true,
      });
      expect(
        (await span('calculate')).attributes[
          'langfuse.observation.status_message'
        ],
      ).toBe(out);
    },
  );
});

describe('personal data and credentials by pattern', () => {
  it('masks an email in the question and the answer', async () => {
    const root = tracer.root('mail me at a@b.io');
    root.end({ answer: 'Sent to c@d.io.' });
    const s = await span('answer-question');
    expect(input(s)).toBe('mail me at [REDACTED]');
    expect(output(s)).toBe('Sent to [REDACTED].');
  });

  it('masks a bearer token in a tool result, a tool name and a status message', async () => {
    const token = 'Bearer abcdef0123456789abcdef';
    const root = tracer.root('q');
    root.tool({ name: `t-${token}`, arguments: '{}' }).end({
      output: `{"error":"bad ${token}"}`,
      failed: true,
    });
    root.end({ error: `failed with ${token}` });
    await tracer.flush();
    expect(
      JSON.stringify(
        exporter.getFinishedSpans().map((s) => [s.name, s.attributes]),
      ),
    ).not.toContain('abcdef0123456789abcdef');
  });

  it('masks an email in the reason of a failed stream and in the metadata', async () => {
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'a@b.io', messages });
    generation.streamFailed('broke for a@b.io');
    generation.end({ model: 'm', text: 'x' });
    await tracer.flush();
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((s) => [s.name, s.attributes]),
    );
    expect(everything).not.toContain('a@b.io');
  });
});

describe('a tool whose name is a key', () => {
  it('hides the key in the name of the observation', async () => {
    tracer.root('q').tool({ name: 'sk-or-OPENROUTER', arguments: '{}' }).end({
      output: 'x',
      failed: false,
    });
    await tracer.flush();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain(
      '[REDACTED]',
    );
    expect(
      JSON.stringify(exporter.getFinishedSpans().map((s) => s.name)),
    ).not.toContain('sk-or-OPENROUTER');
  });
});

describe('a fault inside tracing', () => {
  it('falls back to a span that does nothing when a generation cannot be started', () => {
    const throwing = new Proxy([], {
      get: () => {
        throw new Error('boom');
      },
    });
    const generation = tracer
      .root('q')
      .generation({ requestedModel: 'm', messages: throwing });
    expect(() => {
      generation.retried();
      generation.end({ text: 'a' });
    }).not.toThrow();
  });

  it('falls back to a span that does nothing when a tool cannot be started', () => {
    const call = {
      name: 'calculate',
      get arguments(): string {
        throw new Error('boom');
      },
    };
    const tool = tracer.root('q').tool(call);
    expect(() => tool.end({ output: 'x', failed: false })).not.toThrow();
  });

  it('does not reach the caller', () => {
    const root = tracer.root('q');
    const bad = {
      toJSON: () => {
        throw new Error('boom');
      },
    };
    expect(() =>
      root
        .generation({
          requestedModel: 'm',
          messages: [{ role: 'user', content: bad as unknown as string }],
        })
        .end({}),
    ).not.toThrow();
    expect(() => root.end({ answer: 'a' })).not.toThrow();
  });
});

describe('flushing', () => {
  it('rejects when the exporter never answers, after the time it was given', async () => {
    const hanging = createLangfuseTracer({
      config,
      exporter: { export: () => {}, shutdown: async () => {} },
      secrets: [],
      version: '1.2.3',
      flushTimeoutMs: 30,
    });
    hanging.root('q').end({ answer: 'a' });
    const started = Date.now();
    await expect(hanging.flush()).rejects.toThrow(ApiError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('says the trace may be incomplete', async () => {
    const failing = createLangfuseTracer({
      config,
      exporter: {
        export: (_spans, done) => done({ code: 1, error: new Error('no') }),
        shutdown: async () => {},
      },
      secrets: [],
      version: '1.2.3',
    });
    failing.root('q').end({ answer: 'a' });
    await expect(failing.flush()).rejects.toThrow(
      'The trace could not be delivered to Langfuse and may be incomplete.',
    );
  });

  it('clears its timer when the flush succeeds, so the process can exit at once', async () => {
    const WAIT = 12_345;
    const real = globalThis.setTimeout;
    const ours: unknown[] = [];
    const set = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const handle = real(fn, ms);
      if (ms === WAIT) {
        ours.push(handle);
      }
      return handle;
    }) as typeof setTimeout);
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const quick = createLangfuseTracer({
      config,
      exporter,
      secrets: [],
      version: '1.2.3',
      flushTimeoutMs: WAIT,
    });
    quick.root('q').end({ answer: 'a' });
    await quick.flush();
    expect(ours).toHaveLength(1);
    expect(clear).toHaveBeenCalledWith(ours[0]);
    set.mockRestore();
    clear.mockRestore();
  });
});

describe('aborting', () => {
  it('ends every open observation as an error, and leaves finished ones alone', async () => {
    const root = tracer.root('q');
    root
      .generation({ requestedModel: 'm', messages })
      .end({ model: 'm', text: 'a' });
    root.generation({ requestedModel: 'm', messages });
    root.tool({ name: 'calculate', arguments: '{}' });
    tracer.abort('The run was interrupted.');
    await tracer.flush();
    const finished = exporter.getFinishedSpans();
    expect(finished.map((s) => s.name).sort()).toEqual([
      'answer-question',
      'calculate',
      'generate-response',
      'generate-response',
    ]);
    const level = (s: ReadableSpan) =>
      s.attributes['langfuse.observation.level'];
    const generations = finished.filter((s) => s.name === 'generate-response');
    expect(generations.map(level).sort()).toEqual(['ERROR', undefined]);
    for (const name of ['answer-question', 'calculate']) {
      const s = finished.find((x) => x.name === name);
      expect(level(s as ReadableSpan)).toBe('ERROR');
      expect(s?.attributes['langfuse.observation.status_message']).toBe(
        INTERRUPTED,
      );
    }
  });

  it('makes a later end of an aborted observation do nothing', async () => {
    const root = tracer.root('q');
    const generation = root.generation({ requestedModel: 'm', messages });
    tracer.abort('The run was interrupted.');
    generation.end({ model: 'm', text: 'late' });
    root.end({ answer: 'late' });
    await tracer.flush();
    expect(exporter.getFinishedSpans()).toHaveLength(2);
    expect(
      exporter
        .getFinishedSpans()
        .every((s) => s.attributes['langfuse.observation.level'] === 'ERROR'),
    ).toBe(true);
  });

  it('ends an observation once, however often it is told to', async () => {
    const root = tracer.root('q');
    root.end({ answer: 'a' });
    root.end({ answer: 'b' });
    await tracer.flush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(output(await span('answer-question'))).toBe('a');
  });
});

describe('after an abort', () => {
  it('records nothing more, and the loop that goes on is not hurt', async () => {
    const root = tracer.root('q');
    tracer.abort(INTERRUPTED);
    const generation = root.generation({ requestedModel: 'm', messages });
    const tool = root.tool({ name: 'calculate', arguments: '{}' });
    expect(() => {
      generation.retried();
      generation.end({ text: 'late' });
      tool.end({ output: 'x', failed: false });
      root.end({ answer: 'late' });
    }).not.toThrow();
    await tracer.flush();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      'answer-question',
    ]);
  });
});

describe('a root that ends while a call is still running', () => {
  it('ends the call as an error with the error of the run, so that it is exported', async () => {
    const root = tracer.root('q');
    root.tool({ name: 'calculate', arguments: '{}' });
    root.end({ error: 'Another call threw.' });
    const t = await span('calculate');
    expect(t.attributes['langfuse.observation.level']).toBe('ERROR');
    expect(t.attributes['langfuse.observation.status_message']).toBe(
      'Another call threw.',
    );
  });

  it('gives the interrupted message when the run did not fail', async () => {
    const root = tracer.root('q');
    root.generation({ requestedModel: 'm', messages });
    root.end({ answer: 'a' });
    expect(
      (await span('generate-response')).attributes[
        'langfuse.observation.status_message'
      ],
    ).toBe(INTERRUPTED);
  });
});

describe('the no-op tracer', () => {
  it('accepts every call and flushes', async () => {
    const root = NO_TRACER.root('q');
    root.generation({ requestedModel: 'm', messages }).retried();
    root.generation({ requestedModel: 'm', messages }).firstToken();
    root.generation({ requestedModel: 'm', messages }).streamFailed('x');
    root.generation({ requestedModel: 'm', messages }).end({ text: 'a' });
    root
      .tool({ name: 't', arguments: '{}' })
      .end({ output: 'x', failed: false });
    root.end({ answer: 'a' });
    NO_TRACER.abort('x');
    await expect(NO_TRACER.flush()).resolves.toBeUndefined();
  });
});
