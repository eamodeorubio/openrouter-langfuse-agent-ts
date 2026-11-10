import type {
  ChatAssistantMessage,
  ChatMessages,
} from '@openrouter/sdk/models';
import type { ToolCall } from './assemble.js';
import type { Round } from './chat.js';
import { redactKey } from './text.js';
import { callTool, toContent } from './tools/registry.js';
import type { Tool, ToolContext } from './tools/types.js';
import { NO_ROOT, type RootSpan } from './tracing/tracer.js';

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

/** How a call ended: the text that went back to the model, or the message of a tool that threw, and whether it was an error. */
export interface CallOutcome {
  output: string;
  failed: boolean;
}

/**
 * Starts every call at once and waits for all of them. The tool messages come
 * back in the order of the calls, with the key redacted from each result.
 * Each call is recorded on `root` as it starts and as it ends, and its
 * outcome is written to `outcomes` at the call's index as it ends. A call that
 * has not ended when another throws has none.
 */
export const runCalls = async (
  tools: readonly Tool[],
  calls: ToolCall[],
  context: ToolContext,
  apiKey: string,
  root: RootSpan = NO_ROOT,
  // Stryker disable next-line ArrayDeclaration: equivalent because a list the caller does not pass is only written to, never read.
  outcomes: (CallOutcome | undefined)[] = [],
): Promise<ChatMessages[]> =>
  Promise.all(
    calls.map(async (call, index) => {
      const span = root.tool({ name: call.name, arguments: call.arguments });
      try {
        const result = await callTool(tools, call.name, call.arguments, {
          ...context,
          traceparent: span.traceparent,
        });
        const content = redactKey(toContent(result), apiKey);
        span.end({ output: content, failed: !result.ok });
        outcomes[index] = { output: content, failed: !result.ok };
        return { role: 'tool' as const, toolCallId: call.id, content };
      } catch (error) {
        const output = redactKey(
          error instanceof Error ? error.message : String(error),
          apiKey,
        );
        span.end({ output, failed: true });
        outcomes[index] = { output, failed: true };
        throw error;
      }
    }),
  );
