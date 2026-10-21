import type { ChatMessages } from '@openrouter/sdk/models';
import { chat, IDLE_TIMEOUT_MS } from './chat.js';
import { createClient } from './client.js';
import type { Config } from './config.js';
import { ApiError, LimitError } from './errors.js';
import { INSTRUCTIONS } from './instructions.js';
import { redactKey } from './text.js';
import { functionTools, TOOLS } from './tools/registry.js';
import { assistantTurn, runCalls } from './turn.js';
import type { AskEvent, Usage } from './types.js';
import { addUsage } from './usage.js';

/** The most rounds that may end in tool calls. The request after them forbids tools. */
const MAX_TOOL_ROUNDS = 8;

/** The most one tool call may take in all. */
const TOOL_TIMEOUT_MS = 60_000;

const NO_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

/** Test seams: a short idle limit (never set by `run`) and a local server (`run` forwards its `Io.serverURL`; production leaves it unset). */
export interface AskOptions {
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  serverURL?: string;
}

/**
 * Asks the model one question and yields the answer as it arrives. The model
 * may call tools; each round of calls is run, its results are sent back, and
 * the next response is read, until one holds no tool call. Seen from outside
 * it is one question and one answer. Every request is retried on its own,
 * under the rule in `chat`.
 */
export async function* ask(
  { apiKey, model }: Config,
  question: string,
  {
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    toolTimeoutMs = TOOL_TIMEOUT_MS,
    serverURL,
  }: AskOptions = {},
): AsyncGenerator<AskEvent, void> {
  const client = createClient(apiKey, serverURL);
  const tools = functionTools(TOOLS);
  const messages: ChatMessages[] = [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: question },
  ];
  let total = NO_USAGE;
  // The end of the text written so far, to keep the text of two rounds apart.
  let written = '';

  for (let toolRounds = 0; ; toolRounds++) {
    const forbidTools = toolRounds >= MAX_TOOL_ROUNDS;
    const round = chat(
      client,
      {
        model,
        messages,
        tools,
        toolChoice: forbidTools ? 'none' : undefined,
      },
      idleTimeoutMs,
    );
    let separate = written !== '' && !written.endsWith('\n');
    let step = await round.next();
    while (!step.done) {
      if (step.value.kind === 'content') {
        if (separate) {
          yield { kind: 'content', text: '\n' };
          separate = false;
        }
        written = step.value.text;
      }
      yield step.value;
      step = await round.next();
    }
    const response = step.value;

    if (response.toolCalls.length === 0 && !response.text) {
      throw new ApiError('The API response held no answer.');
    }
    if (!response.usage) {
      throw new ApiError('The API response held no token usage.');
    }
    total = addUsage(total, response.usage);
    if (response.toolCalls.length === 0) {
      yield { kind: 'done', model: response.model, usage: total };
      return;
    }
    if (response.toolCalls.some((call) => !call.id)) {
      throw new ApiError('The API response held a tool call without an id.');
    }
    if (forbidTools) {
      throw new LimitError(
        `The model kept calling tools after ${MAX_TOOL_ROUNDS} rounds of them. Ask a narrower question.`,
      );
    }

    messages.push(assistantTurn(response));
    for (const call of response.toolCalls) {
      yield {
        kind: 'tool',
        name: call.name,
        arguments: redactKey(call.arguments, apiKey),
      };
    }
    messages.push(
      ...(await runCalls(
        TOOLS,
        response.toolCalls,
        { client, timeoutMs: toolTimeoutMs },
        apiKey,
      )),
    );
  }
}
