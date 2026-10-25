import type { ChatMessages } from '@openrouter/sdk/models';

/**
 * The messages as Langfuse renders a conversation: the OpenAI shape, with
 * `tool_calls` on the assistant message and `tool_call_id` on its results.
 * Reasoning blocks are left out: they are opaque, often encrypted, and the
 * thinking is recorded as text on the reply.
 */
export const toOpenAiMessages = (messages: ChatMessages[]): object[] =>
  messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content ?? null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map(
                ({ id, type, function: fn }) => ({
                  id,
                  type,
                  function: { name: fn.name, arguments: fn.arguments },
                }),
              ),
            }
          : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  });
