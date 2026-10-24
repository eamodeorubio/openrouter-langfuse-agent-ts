import { describe, expect, it } from 'vitest';
import { toOpenAiMessages } from '../src/tracing/messages.js';

describe('toOpenAiMessages', () => {
  it('keeps the role and the text of a system or user message', () => {
    expect(
      toOpenAiMessages([
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ]),
    ).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
  });

  it('gives an assistant message its text, and null when it has none', () => {
    expect(
      toOpenAiMessages([
        { role: 'assistant', content: 'hello' },
        { role: 'assistant', content: null },
        { role: 'assistant' },
      ]),
    ).toEqual([
      { role: 'assistant', content: 'hello' },
      { role: 'assistant', content: null },
      { role: 'assistant', content: null },
    ]);
  });

  it('leaves tool_calls out of an assistant message that made none', () => {
    const [plain, empty] = toOpenAiMessages([
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'a', toolCalls: [] },
    ]);
    expect(plain).not.toHaveProperty('tool_calls');
    expect(empty).not.toHaveProperty('tool_calls');
  });

  it('turns tool calls and tool results into the OpenAI shape, and drops reasoning blocks', () => {
    expect(
      toOpenAiMessages([
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'f', arguments: '{}' },
            },
          ],
          reasoningDetails: [{ type: 'reasoning.encrypted', data: 'x' }],
        } as never,
        { role: 'tool', toolCallId: 'c1', content: 'r' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'f', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ]);
  });
});
