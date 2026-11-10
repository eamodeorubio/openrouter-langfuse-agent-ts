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
import { ask } from '../src/ask.js';
import { LimitError } from '../src/errors.js';
import type { AskEvent } from '../src/types.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import { contentChunk, sseBody, toolRound, usageChunk } from './fixtures.js';

// The tools are ones the test controls: one returns at once, one waits for a
// gate, one never returns, one throws. The registry's other functions are real.
const behaviors = vi.hoisted(
  () => ({}) as Record<string, (args: unknown) => Promise<unknown> | unknown>,
);

vi.mock('../src/tools/registry.js', async (original) => {
  const { z } = await import('zod');
  const real = await original<typeof import('../src/tools/registry.js')>();
  const tools = ['ok', 'a', 'b', 'c', 'd', 'e', 'stalled', 'boom'].map(
    (name) => ({
      name,
      description: name,
      parameters: z.object({}).strict(),
      run: async () => ({
        ok: true as const,
        value: await behaviors[name]?.({}),
      }),
    }),
  );
  return { ...real, TOOLS: tools };
});

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const config = { apiKey: 'sk-test', model: 'req/model' };
const call = (id: string, name: string) => ({ id, name, arguments: '{}' });
const answer = () =>
  sseBody(
    contentChunk('done'),
    usageChunk({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  );

const LIMIT = '[LIMIT_EXCEEDED] Tool calls limit exceeded';
const NOT_COMPLETED = '[TOOL_CALL_NOT_COMPLETED] Tool call did not complete';

let api: FakeApi;
beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(() => api.close());
beforeEach(() => {
  api.reset();
  for (const name of Object.keys(behaviors)) {
    delete behaviors[name];
  }
  behaviors.ok = () => 'fine';
});

const collect = async (): Promise<{ events: AskEvent[]; error?: unknown }> => {
  const events: AskEvent[] = [];
  try {
    for await (const event of ask(config, 'q', { serverURL: api.url })) {
      events.push(event);
    }
    return { events };
  } catch (error) {
    return { events, error };
  }
};

const calls = (events: AskEvent[]) =>
  events.filter((event) => event.kind === 'tool-call');

describe('tool-call events', () => {
  it('yields one event per call after its batch, with the round of the response that asked', async () => {
    api.reply(200, toolRound([call('1', 'ok'), call('2', 'ok')]));
    api.reply(200, toolRound([call('3', 'ok')]));
    api.reply(200, answer());
    const { events } = await collect();
    expect(calls(events)).toEqual([
      {
        kind: 'tool-call',
        round: 1,
        name: 'ok',
        arguments: '{}',
        output: '"fine"',
        failed: false,
      },
      {
        kind: 'tool-call',
        round: 1,
        name: 'ok',
        arguments: '{}',
        output: '"fine"',
        failed: false,
      },
      {
        kind: 'tool-call',
        round: 2,
        name: 'ok',
        arguments: '{}',
        output: '"fine"',
        failed: false,
      },
    ]);
  });

  it('follows the `tool` event of the same call, which still comes before any call runs', async () => {
    api.reply(200, toolRound([call('1', 'ok')]));
    api.reply(200, answer());
    const { events } = await collect();
    const kinds = events
      .map((event) => event.kind)
      .filter((kind) => kind.startsWith('tool'));
    expect(kinds).toEqual(['tool', 'tool-call']);
  });

  it('marks a result that is an error as failed, and keeps the arguments as sent', async () => {
    api.reply(200, toolRound([{ id: '1', name: 'ok', arguments: '{"x":1}' }]));
    api.reply(200, answer());
    const { events } = await collect();
    const [entry] = calls(events);
    expect(entry).toMatchObject({ arguments: '{"x":1}', failed: true });
    expect(JSON.parse((entry as { output: string }).output).error).toMatch(
      /Invalid arguments/,
    );
  });

  it('puts the events of a batch in the order of the response, whatever order the calls finish in', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }).chain((n) =>
          fc.shuffledSubarray(
            Array.from({ length: n }, (_, i) => i),
            { minLength: n, maxLength: n },
          ),
        ),
        async (finishOrder) => {
          api.reset();
          const gates = finishOrder.map(() => {
            let open = () => {};
            const gate = new Promise<void>((resolve) => {
              open = resolve;
            });
            return { gate, open };
          });
          for (const [index] of finishOrder.entries()) {
            const gate = gates[index];
            behaviors[names[index] ?? ''] = async () => {
              await gate?.gate;
              return index;
            };
          }
          api.reply(
            200,
            toolRound(
              finishOrder.map((_, i) => call(`id${i}`, names[i] ?? '')),
            ),
          );
          api.reply(200, answer());
          const running = collect();
          await new Promise((resolve) => setTimeout(resolve, 5));
          for (const index of finishOrder) {
            gates[index]?.open();
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          const { events } = await running;
          expect(calls(events).map((event) => event.name)).toEqual(
            finishOrder.map((_, i) => names[i]),
          );
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('a tool that throws', () => {
  it('yields every call of the batch, then rethrows: the thrower with its message, a call still running as not completed, one that finished with its result', async () => {
    behaviors.boom = () => {
      throw new Error('exploded');
    };
    behaviors.stalled = () => new Promise(() => {});
    api.reply(
      200,
      toolRound([call('1', 'stalled'), call('2', 'ok'), call('3', 'boom')]),
    );
    const { events, error } = await collect();
    expect(error).toEqual(new Error('exploded'));
    expect(
      calls(events).map(({ name, output, failed }) => ({
        name,
        output,
        failed,
      })),
    ).toEqual([
      { name: 'stalled', output: NOT_COMPLETED, failed: true },
      { name: 'ok', output: '"fine"', failed: false },
      { name: 'boom', output: 'exploded', failed: true },
    ]);
  });
});

describe('the round that hits the limit', () => {
  it('yields its calls as failed with the limit output, no `tool` event, then throws the limit error', async () => {
    for (let i = 0; i < 9; i++) {
      api.reply(200, toolRound([call(`c${i}`, 'ok'), call(`d${i}`, 'ok')]));
    }
    const { events, error } = await collect();
    expect(error).toBeInstanceOf(LimitError);
    const last = calls(events).filter((event) => event.round === 9);
    expect(last).toEqual([
      {
        kind: 'tool-call',
        round: 9,
        name: 'ok',
        arguments: '{}',
        output: LIMIT,
        failed: true,
      },
      {
        kind: 'tool-call',
        round: 9,
        name: 'ok',
        arguments: '{}',
        output: LIMIT,
        failed: true,
      },
    ]);
    expect(events.filter((event) => event.kind === 'tool')).toHaveLength(16);
    expect(calls(events).filter((event) => !event.failed)).toHaveLength(16);
  });
});
