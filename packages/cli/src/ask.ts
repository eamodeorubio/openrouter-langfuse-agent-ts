import type { ChatMessages } from '@openrouter/sdk/models';
import { chat, IDLE_TIMEOUT_MS, type Round } from './chat.js';
import { createClient } from './client.js';
import type { Config } from './config.js';
import { ApiError, LimitError } from './errors.js';
import { INSTRUCTIONS } from './instructions.js';
import { oneLine, redactKey } from './text.js';
import { functionTools, TOOLS } from './tools/registry.js';
import {
  type GenerationResult,
  INTERRUPTED,
  NO_TRACER,
  type RootSpan,
  type Tracer,
} from './tracing/tracer.js';
import { assistantTurn, runCalls } from './turn.js';
import type { AskEvent, Usage } from './types.js';
import { addUsage } from './usage.js';

/** The most rounds that may end in tool calls. The request after them forbids tools. */
const MAX_TOOL_ROUNDS = 8;

/** The most one tool call may take in all. */
const TOOL_TIMEOUT_MS = 60_000;

/** Where the sum starts. A cost of zero, so that the first request's cost survives and a request without one removes it. */
const ZERO_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
};

/** Test seams: a short idle limit and a local server. `run` forwards its `Io.idleTimeoutMs` and `Io.serverURL`; production leaves both unset. */
export interface AskOptions {
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  serverURL?: string;
  /** Where the run is recorded. Without one it is not. */
  tracer?: Tracer;
}

/** The response is the answer the user gets: it has text, and no tool call to follow. */
const isAnswer = (round: Round): boolean =>
  round.toolCalls.length === 0 && round.text !== '';

const describe = (error: unknown): string =>
  oneLine(error instanceof Error ? error.message : String(error));

/**
 * Asks the model one question and yields the answer as it arrives. The model
 * may call tools; each round of calls is run, its results are sent back, and
 * the next response is read, until one holds no tool call. Seen from outside
 * it is one question and one answer. Every request is retried on its own,
 * under the rule in `chat`.
 */
export async function* ask(
  config: Config,
  question: string,
  options: AskOptions = {},
): AsyncGenerator<AskEvent, void> {
  const root = (options.tracer ?? NO_TRACER).root(question);
  let ended = false;
  const finish = (result: { answer?: string; error?: string }) => {
    if (!ended) {
      ended = true;
      root.end(result);
    }
  };
  try {
    if (root.traceId) {
      yield { kind: 'trace', id: root.traceId };
    }
    yield* converse(config, question, options, root, (answer) =>
      finish({ answer }),
    );
  } catch (error) {
    finish({ error: describe(error) });
    throw error;
  } finally {
    // Reached unfinished only when the reader stopped before the end.
    finish({ error: INTERRUPTED });
  }
}

async function* converse(
  { apiKey, model }: Config,
  question: string,
  {
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    toolTimeoutMs = TOOL_TIMEOUT_MS,
    serverURL,
  }: AskOptions,
  root: RootSpan,
  answered: (answer: string) => void,
): AsyncGenerator<AskEvent, void> {
  const client = createClient(apiKey, serverURL);
  const tools = functionTools(TOOLS);
  const messages: ChatMessages[] = [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: question },
  ];
  let total = ZERO_USAGE;
  // The end of the text written so far, to keep the text of two rounds apart.
  let written = '';

  for (let toolRounds = 0; ; toolRounds++) {
    const forbidTools = toolRounds >= MAX_TOOL_ROUNDS;
    const generation = root.generation({ requestedModel: model, messages });
    const round = chat(
      client,
      {
        model,
        messages,
        tools,
        toolChoice: forbidTools ? 'none' : undefined,
      },
      idleTimeoutMs,
      generation,
    );
    let separate = written !== '' && !written.endsWith('\n');
    let response: Round;
    let outcome: GenerationResult = { error: INTERRUPTED };
    try {
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
      response = step.value;
      outcome = {
        model: response.model,
        text: response.text,
        toolCalls: response.toolCalls,
        thinking: response.thinking,
        finishReason: response.finishReason,
        usage: response.usage,
        final: isAnswer(response),
      };
    } catch (error) {
      outcome = { error: describe(error) };
      throw error;
    } finally {
      generation.end(outcome);
    }

    if (!isAnswer(response) && response.toolCalls.length === 0) {
      throw new ApiError(
        'The model returned no answer. Try again, or choose another model.',
      );
    }
    if (!response.usage) {
      throw new ApiError(
        "OpenRouter's reply did not report how many tokens it used. Try again, or choose another model.",
      );
    }
    total = addUsage(total, response.usage);
    if (isAnswer(response)) {
      answered(response.text);
      yield { kind: 'done', model: response.model, usage: total };
      return;
    }
    if (response.toolCalls.some((call) => !call.id)) {
      throw new ApiError(
        'The model asked to use a tool in a way this tool cannot follow. Try again, or choose another model.',
      );
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
        root,
      )),
    );
  }
}
