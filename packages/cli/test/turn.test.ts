import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Tool, ToolContext } from '../src/tools/types.js';
import type { RootSpan } from '../src/tracing/tracer.js';
import { runCalls } from '../src/turn.js';

const context = {} as ToolContext;

const tool = (name: string, run: Tool['run']): Tool => ({
  name,
  description: name,
  parameters: z.object({ n: z.number().optional() }),
  run,
});

/** A root that writes down what happens to its tool spans, in order. */
const recorder = () => {
  const log: string[] = [];
  const ended: { name: string; output: string; failed: boolean }[] = [];
  const root: RootSpan = {
    generation: () => {
      throw new Error('not used');
    },
    tool: ({ name, arguments: args }) => {
      log.push(`start ${name} ${args}`);
      return {
        end: (result) => {
          log.push(`end ${name}`);
          ended.push({ name, ...result });
        },
      };
    },
    end: () => {},
  };
  return { root, log, ended };
};

const call = (id: string, name: string, args = '{}') => ({
  id,
  name,
  arguments: args,
});

describe('runCalls with a tracer', () => {
  it('opens a tool span per call, with the arguments the model sent, before any call ends', async () => {
    const { root, log } = recorder();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = tool('slow', async () => {
      await gate;
      return { ok: true, value: 1 };
    });
    const fast = tool('fast', async () => ({ ok: true, value: 2 }));
    const running = runCalls(
      [slow, fast],
      [call('1', 'slow', '{"n":1}'), call('2', 'fast', '{"n":2}')],
      context,
      'key',
      root,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual([
      'start slow {"n":1}',
      'start fast {"n":2}',
      'end fast',
    ]);
    release();
    await running;
    expect(log.at(-1)).toBe('end slow');
  });

  it('ends a span with the text that went back to the model, and ok when the call worked', async () => {
    const { root, ended } = recorder();
    const messages = await runCalls(
      [tool('t', async () => ({ ok: true, value: { a: 1 } }))],
      [call('1', 't')],
      context,
      'key',
      root,
    );
    expect(ended).toEqual([{ name: 't', output: '{"a":1}', failed: false }]);
    expect(messages[0]?.content).toBe('{"a":1}');
  });

  it('ends a span as failed when the tool says it failed', async () => {
    const { root, ended } = recorder();
    await runCalls(
      [tool('t', async () => ({ ok: false, message: 'No such model.' }))],
      [call('1', 't')],
      context,
      'key',
      root,
    );
    expect(ended).toEqual([
      { name: 't', output: '{"error":"No such model."}', failed: true },
    ]);
  });

  it.each([
    ['an unknown tool', call('1', 'nope')],
    ['arguments that are not JSON', call('1', 't', '{oops')],
    ['arguments the schema refuses', call('1', 't', '{"n":"x"}')],
  ])('ends a span as failed for %s', async (_name, bad) => {
    const { root, ended } = recorder();
    await runCalls(
      [tool('t', async () => ({ ok: true, value: 1 }))],
      [bad],
      context,
      'key',
      root,
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]?.failed).toBe(true);
  });

  it('keeps the key out of the span, as it keeps it out of the message', async () => {
    const { root, ended } = recorder();
    await runCalls(
      [tool('t', async () => ({ ok: true, value: 'the key is sk-secret' }))],
      [call('1', 't')],
      context,
      'sk-secret',
      root,
    );
    expect(ended[0]?.output).not.toContain('sk-secret');
  });

  it('ends the span as failed, and rethrows, when a tool throws', async () => {
    const { root, ended } = recorder();
    await expect(
      runCalls(
        [
          tool('t', async () => {
            throw new Error('exploded');
          }),
        ],
        [call('1', 't')],
        context,
        'key',
        root,
      ),
    ).rejects.toThrow('exploded');
    expect(ended).toEqual([{ name: 't', output: 'exploded', failed: true }]);
  });

  it('works without a tracer', async () => {
    const messages = await runCalls(
      [tool('t', async () => ({ ok: true, value: 1 }))],
      [call('1', 't')],
      context,
      'key',
    );
    expect(messages).toEqual([{ role: 'tool', toolCallId: '1', content: '1' }]);
  });
});
