import type {
  ChatAssistantMessage,
  ChatMessages,
} from '@openrouter/sdk/models';
import type { ToolCall } from './assemble.js';
import type { Round } from './chat.js';
import { redactKey } from './text.js';
import { runTool } from './tools/registry.js';
import type { Tool, ToolContext } from './tools/types.js';

/**
 * The assistant message that records a round for the next request: its text,
 * its tool calls and its reasoning blocks, as the model sent them.
 */
export const assistantTurn = (round: Round): ChatMessages => ({
  role: 'assistant',
  content: round.text || null,
  toolCalls: round.toolCalls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  })),
  // The blocks are opaque to us and must go back unchanged. The SDK types them
  // as a union of the shapes it knows; ours is the loose shape the join works on.
  reasoningDetails:
    round.reasoningDetails as unknown as ChatAssistantMessage['reasoningDetails'],
});

/**
 * Starts every call at once and waits for all of them. The tool messages come
 * back in the order of the calls, with the key redacted from each result.
 */
export const runCalls = async (
  tools: readonly Tool[],
  calls: ToolCall[],
  context: ToolContext,
  apiKey: string,
): Promise<ChatMessages[]> =>
  Promise.all(
    calls.map(async (call) => ({
      role: 'tool' as const,
      toolCallId: call.id,
      content: redactKey(
        await runTool(tools, call.name, call.arguments, context),
        apiKey,
      ),
    })),
  );
