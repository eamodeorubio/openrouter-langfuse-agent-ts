import { describe, expect, it } from 'vitest';
import {
  DONE,
  recordedCompletion,
  recordedModel,
  recordedStream,
  recordedToolStream,
  recordedUnauthorized,
  sseEvents,
  truncatedStream,
} from './fixtures.js';

const payloads = (body: string) =>
  sseEvents(body)
    .map((event) => event.replace(/^data: /, '').trim())
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data));

describe('recorded fixtures', () => {
  it('hold no key, token, cookie or header', () => {
    const everything = JSON.stringify([
      recordedCompletion,
      recordedUnauthorized,
      recordedModel,
    ])
      .concat(recordedStream)
      .concat(recordedToolStream);
    expect(everything).not.toMatch(
      /sk-or|bearer|set-cookie|authorization|cf-ray|api[_-]?key/i,
    );
  });

  it('record a stream that ends with [DONE] and opens with thinking', () => {
    const events = sseEvents(recordedStream);
    expect(events.at(-1)).toBe(DONE);
    const first = payloads(recordedStream)[0];
    expect(first.choices[0].delta.reasoning).toBeTruthy();
  });

  it('record answer text after the thinking and usage in a chunk of its own', () => {
    const chunks = payloads(recordedStream);
    const answer = chunks
      .map((chunk) => chunk.choices[0]?.delta.content ?? '')
      .join('');
    expect(answer.length).toBeGreaterThan(0);
    const withUsage = chunks.filter((chunk) => chunk.usage);
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0]).toBe(chunks.at(-1));
  });

  it('can be cut off in the middle of an event', () => {
    const cut = truncatedStream();
    expect(cut.endsWith('\n\n')).toBe(false);
    expect(() => JSON.parse(cut.split('data: ').at(-1) as string)).toThrow();
  });
});
