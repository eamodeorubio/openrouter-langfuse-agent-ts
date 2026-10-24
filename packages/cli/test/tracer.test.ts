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
    root.generation({ requestedModel: 'm', messages }).end({ text: 'a' });
    root
      .tool({ name: 't', arguments: '{}' })
      .end({ output: 'x', failed: false });
    root.end({ answer: 'a' });
    NO_TRACER.abort('x');
    await expect(NO_TRACER.flush()).resolves.toBeUndefined();
  });
});
