import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  joinReasoningDetails,
  joinToolCalls,
  type ToolCallFragment,
} from '../src/assemble.js';

/** Cuts `text` at the given positions into pieces that join back to `text`. */
const cut = (text: string, at: number[]): string[] => {
  const points = [...new Set(at.map((n) => n % (text.length + 1)))].sort(
    (a, b) => a - b,
  );
  const pieces: string[] = [];
  let from = 0;
  for (const point of points) {
    pieces.push(text.slice(from, point));
    from = point;
  }
  pieces.push(text.slice(from));
  return pieces;
};

/** Merges queues into one list, keeping the order inside each queue; `picks` decide which queue goes next. */
const interleave = <T>(queues: T[][], picks: number[]): T[] => {
  const left = queues.map((queue) => [...queue]);
  const merged: T[] = [];
  let step = 0;
  while (left.some((queue) => queue.length > 0)) {
    const open = left.filter((queue) => queue.length > 0);
    const queue = open[(picks[step++] ?? 0) % open.length];
    merged.push(queue?.shift() as T);
  }
  return merged;
};

describe('joinToolCalls', () => {
  it('joins the arguments of one call, taking id and name from the first fragment', () => {
    const fragments: ToolCallFragment[] = [
      { index: 0, id: 'c1', function: { name: 'get_model', arguments: '' } },
      { index: 0, function: { arguments: '{"slug": "openai/' } },
      { index: 0, function: { arguments: 'gpt-5"}' } },
    ];
    expect(joinToolCalls(fragments)).toEqual([
      { id: 'c1', name: 'get_model', arguments: '{"slug": "openai/gpt-5"}' },
    ]);
  });

  it('keeps parallel calls apart by index, in index order', () => {
    const fragments: ToolCallFragment[] = [
      { index: 1, id: 'b', function: { name: 'n2', arguments: '' } },
      { index: 0, id: 'a', function: { name: 'n1', arguments: '{' } },
      { index: 1, function: { arguments: '{}' } },
      { index: 0, function: { arguments: '}' } },
    ];
    expect(joinToolCalls(fragments)).toEqual([
      { id: 'a', name: 'n1', arguments: '{}' },
      { id: 'b', name: 'n2', arguments: '{}' },
    ]);
  });

  it('gives empty text for a call whose fragments carry no id, name or arguments', () => {
    expect(joinToolCalls([{ index: 0 }])).toEqual([
      { id: '', name: '', arguments: '' },
    ]);
    expect(joinToolCalls([{ index: 0, id: 'c' }])).toEqual([
      { id: 'c', name: '', arguments: '' },
    ]);
    expect(joinToolCalls([{ index: 0, function: {} }])).toEqual([
      { id: '', name: '', arguments: '' },
    ]);
  });

  it('gives no calls for no fragments', () => {
    expect(joinToolCalls([])).toEqual([]);
  });

  it('joins any split and any interleaving of calls into the calls that were sent', () => {
    const call = fc.record({
      id: fc.string({ minLength: 1 }),
      name: fc.string({ minLength: 1 }),
      arguments: fc.string(),
    });
    fc.assert(
      fc.property(
        fc.array(call, { minLength: 1, maxLength: 4 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        fc.array(fc.nat(), { maxLength: 60 }),
        (calls, cuts, picks) => {
          const queues = calls.map((c, index): ToolCallFragment[] => [
            { index, id: c.id, function: { name: c.name, arguments: '' } },
            ...cut(c.arguments, cuts).map((piece) => ({
              index,
              function: { arguments: piece },
            })),
          ]);
          expect(joinToolCalls(interleave(queues, picks))).toEqual(calls);
        },
      ),
    );
  });
});

describe('joinReasoningDetails', () => {
  const text = (extra: object) => ({
    type: 'reasoning.text' as const,
    format: 'anthropic-claude-v1',
    index: 0,
    ...extra,
  });

  it('joins text fragments and takes the signature from the fragment that has it', () => {
    expect(
      joinReasoningDetails([
        text({ text: 'The user ' }),
        text({ text: 'asks.' }),
        text({ signature: 'sig==' }),
      ]),
    ).toEqual([text({ text: 'The user asks.', signature: 'sig==' })]);
  });

  it('keeps blocks of different index or type apart, in the order they appeared', () => {
    const joined = joinReasoningDetails([
      text({ index: 1, text: 'b' }),
      text({ index: 0, text: 'a' }),
      { type: 'reasoning.encrypted' as const, index: 0, data: 'x' },
      text({ index: 1, text: 'c' }),
    ]);
    expect(joined).toEqual([
      text({ index: 1, text: 'bc' }),
      text({ index: 0, text: 'a' }),
      { type: 'reasoning.encrypted', index: 0, data: 'x' },
    ]);
  });

  it('joins summary and encrypted pieces the same way', () => {
    expect(
      joinReasoningDetails([
        { type: 'reasoning.summary', index: 0, summary: 'in ' },
        { type: 'reasoning.summary', index: 0, summary: 'short' },
        { type: 'reasoning.encrypted', index: 1, data: 'ab' },
        { type: 'reasoning.encrypted', index: 1, data: 'cd' },
      ]),
    ).toEqual([
      { type: 'reasoning.summary', index: 0, summary: 'in short' },
      { type: 'reasoning.encrypted', index: 1, data: 'abcd' },
    ]);
  });

  it('passes a block that came whole through unchanged, null fields included', () => {
    const whole = text({ text: 'whole', signature: null, id: null });
    expect(joinReasoningDetails([whole])).toEqual([
      text({ text: 'whole', signature: null, id: null }),
    ]);
  });

  it('keeps an earlier value when a later fragment gives null or nothing for the field', () => {
    const joined = joinReasoningDetails([
      text({ signature: 'sig' }),
      text({ signature: null, id: 'x' }),
      text({ signature: undefined, id: null }),
    ]);
    expect(joined).toEqual([text({ signature: 'sig', id: 'x' })]);
  });

  it('does not turn a null piece of text into the word null', () => {
    expect(
      joinReasoningDetails([text({ text: 'a' }), text({ text: null })]),
    ).toEqual([text({ text: 'a' })]);
  });

  it('lets a later value replace an earlier one for a field that arrives whole', () => {
    expect(
      joinReasoningDetails([text({ format: 'one' }), text({ format: 'two' })]),
    ).toEqual([text({ format: 'two' })]);
  });

  it('gives no blocks for no fragments', () => {
    expect(joinReasoningDetails([])).toEqual([]);
  });

  it('joins any split of the text into the block that was sent, without loss', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        (body, signature, cuts) => {
          const fragments = [
            ...cut(body, cuts).map((piece) => text({ text: piece })),
            text({ signature }),
          ];
          expect(joinReasoningDetails(fragments)).toEqual([
            text({ text: body, signature }),
          ]);
        },
      ),
    );
  });
});
