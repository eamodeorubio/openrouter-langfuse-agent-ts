import type { OpenRouter } from '@openrouter/sdk';
import type {
  ChatFunctionTool,
  ChatMessages,
  ChatResult,
  ChatStreamChunk,
} from '@openrouter/sdk/models';
import {
  joinReasoningDetails,
  joinToolCalls,
  type ReasoningDetail,
  type ToolCall,
  type ToolCallFragment,
} from './assemble.js';
import { withSignal } from './client.js';
import {
  ChunkError,
  IdleTimeout,
  isShapeError,
  StreamError,
  toApiError,
} from './failures.js';
import { backoff, mayRetry } from './retry.js';
import { oneLine } from './text.js';
import type { AskEvent, Usage } from './types.js';

export const IDLE_TIMEOUT_MS = 60_000;

/** The parts of a streamed chunk that the answer is built from. A complete response fills the same fields. */
interface Chunk {
  model: string;
  choices: {
    delta: {
      content?: string | null | undefined;
      reasoning?: string | null | undefined;
      toolCalls?: ToolCallFragment[] | undefined;
      reasoningDetails?: ReasoningDetail[] | undefined;
    };
    finishReason?: string | null | undefined;
  }[];
  usage?: ChatStreamChunk['usage'];
  /** Set only by a streamed chunk that carries an error. */
  error?: { code: number; message: string } | undefined;
}

/** A complete response, from a server that did not stream, read as the single chunk of a stream. */
const asChunk = (result: ChatResult): Chunk => ({
  model: result.model,
  choices: result.choices.map(({ message, finishReason }) => ({
    finishReason,
    delta: {
      content:
        typeof message.content === 'string' ? message.content : undefined,
      reasoning: message.reasoning,
      toolCalls: message.toolCalls?.map((call, index) => ({
        index,
        id: call.id,
        function: call.function,
      })),
      // Blocks that arrive whole may lack an index; the position keeps two of them apart.
      reasoningDetails: message.reasoningDetails?.map((detail, position) => ({
        ...detail,
        index: (detail as { index?: number }).index ?? position,
      })),
    },
  })),
  usage: result.usage,
});

/** What one request to the model holds. */
export interface ChatInput {
  model: string;
  messages: ChatMessages[];
  tools?: ChatFunctionTool[] | undefined;
  /** `none` forbids the tools for this request. */
  toolChoice?: 'auto' | 'none' | undefined;
}

/** A response, read to its end. */
export interface Round {
  /** The model that served it. */
  model: string;
  text: string;
  /** The thinking the model streamed, as text. Empty when it showed none. */
  thinking: string;
  /** Why the model stopped, as the API says. */
  finishReason: string | undefined;
  toolCalls: ToolCall[];
  reasoningDetails: ReasoningDetail[];
  /** Missing when the response held none. */
  usage: Usage | undefined;
}

/** The events a round shows while it arrives. */
export type RoundEvent = Extract<AskEvent, { kind: 'thinking' | 'content' }>;

/** Waits for `work`, but gives up with an `IdleTimeout` when `ms` pass first. */
const within = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new IdleTimeout()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Sends the request and yields its chunks. Nothing may stay silent for longer
 * than `idleTimeoutMs`: the first chunk counts from the moment of sending,
 * each later one from the chunk before. However this ends, short of reaching
 * the end of the stream, the stream is cancelled.
 */
async function* readChunks(
  client: OpenRouter,
  { model, messages, tools, toolChoice }: ChatInput,
  idleTimeoutMs: number,
  traceparent: string | undefined,
): AsyncGenerator<Chunk, void> {
  const controller = new AbortController();
  const sentAt = Date.now();
  let iterator: AsyncIterator<Chunk> | undefined;
  try {
    // Our own signal switches the SDK's whole-request deadline off. The SDK's
    // iterator ignores an abort, so the race below ends the wait; the abort only frees the socket.
    let response: Awaited<ReturnType<typeof client.chat.send>>;
    try {
      response = await within(
        withSignal(controller.signal, () =>
          client.chat.send(
            {
              chatRequest: {
                model,
                stream: true,
                messages,
                tools,
                toolChoice,
                parallelToolCalls: tools ? true : undefined,
              },
            },
            {
              signal: controller.signal,
              headers: traceparent ? { traceparent } : undefined,
            },
          ),
        ),
        idleTimeoutMs,
      );
    } catch (error) {
      // A response that never came is still open; one that failed has been read already.
      // Stryker disable next-line ConditionalExpression: equivalent on a real socket, because aborting a request that has already failed does nothing; the condition only keeps the abort away from nock's mock sockets, which cannot take it.
      if (error instanceof IdleTimeout) {
        controller.abort();
      }
      throw error;
    }
    // With `stream: true` the SDK returns an event stream. A server that
    // ignores the flag, a proxy for one, gets a complete result instead.
    if (!(Symbol.asyncIterator in response)) {
      yield asChunk(response);
      return;
    }
    iterator = response[Symbol.asyncIterator]();
    let limit = Math.max(0, idleTimeoutMs - (Date.now() - sentAt));
    for (;;) {
      let step: IteratorResult<Chunk>;
      try {
        step = await within(iterator.next(), limit);
      } catch (error) {
        // A stalled read ignores everything but the abort, which also frees the socket.
        controller.abort();
        throw error instanceof IdleTimeout || isShapeError(error)
          ? error
          : new StreamError(
              error instanceof Error ? error.message : String(error),
            );
      }
      if (step.done) {
        return;
      }
      limit = idleTimeoutMs;
      yield step.value;
    }
  } finally {
    // Cancelling the reader lets go of a stream we abandon; on one that has ended it does nothing.
    // Stryker disable next-line OptionalChaining: equivalent because the SDK's event stream always has `return`, and `return()` always gives a promise.
    iterator?.return?.()?.catch(() => undefined);
  }
}

/** One request, read to the end: events while it arrives, the assembled round at the end. */
async function* attempt(
  client: OpenRouter,
  input: ChatInput,
  idleTimeoutMs: number,
  traceparent: string | undefined,
): AsyncGenerator<RoundEvent, Round> {
  // Stryker disable next-line StringLiteral: equivalent because the first chunk replaces it before it is read, and a stream without chunks fails before it is used.
  let servedModel = '';
  let text = '';
  let thinking = '';
  let finishReason: string | undefined;
  let usage: Chunk['usage'];
  const toolFragments: ToolCallFragment[] = [];
  const detailFragments: ReasoningDetail[] = [];
  for await (const chunk of readChunks(
    client,
    input,
    idleTimeoutMs,
    traceparent,
  )) {
    if (chunk.error) {
      throw new ChunkError(chunk.error.code, chunk.error.message);
    }
    servedModel = chunk.model;
    const delta = chunk.choices[0]?.delta;
    finishReason = chunk.choices[0]?.finishReason ?? finishReason;
    toolFragments.push(...(delta?.toolCalls ?? []));
    detailFragments.push(...(delta?.reasoningDetails ?? []));
    if (delta?.reasoning) {
      thinking += delta.reasoning;
      yield { kind: 'thinking', text: delta.reasoning };
    }
    if (delta?.content) {
      text += delta.content;
      yield { kind: 'content', text: delta.content };
    }
    usage = chunk.usage ?? usage;
  }
  return {
    model: servedModel,
    text,
    thinking,
    finishReason,
    toolCalls: joinToolCalls(toolFragments),
    reasoningDetails: joinReasoningDetails(detailFragments),
    usage: usage && {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens:
        usage.completionTokensDetails?.reasoningTokens ?? undefined,
      cachedTokens: usage.promptTokensDetails?.cachedTokens ?? undefined,
      cost: usage.cost ?? undefined,
    },
  };
}

/** A failure of the stream itself, as opposed to a refusal before it started. */
const isStreamFailure = (error: unknown): boolean =>
  error instanceof StreamError ||
  error instanceof IdleTimeout ||
  error instanceof ChunkError;

/** Tags a request with its trace context, and is told of what happens to it that its result does not show. */
export interface RoundObserver {
  /** The trace context to send with every attempt, when the run is traced. */
  readonly traceparent?: string | undefined;
  /** A failed attempt is about to be repeated. */
  retried(): void;
  /** The first text or thinking of the request has arrived. */
  firstToken(): void;
  /** The stream broke, went idle or carried an error, and the request ends with it. `message` is one line. */
  streamFailed(message: string): void;
}

/**
 * One request to the model, retried on transient failure. A retry happens
 * only while nothing has been yielded: after that it would repeat text the
 * caller has already seen. Tool-call fragments are not yielded, so they do not
 * close the door. The loop is written out here and not taken from `withRetry`
 * because it must know whether an event was yielded before the failure.
 */
export async function* chat(
  client: OpenRouter,
  input: ChatInput,
  idleTimeoutMs: number = IDLE_TIMEOUT_MS,
  observer?: RoundObserver,
): AsyncGenerator<RoundEvent, Round> {
  for (let retry = 0; ; retry++) {
    let started = false;
    try {
      const events = attempt(
        client,
        input,
        idleTimeoutMs,
        observer?.traceparent,
      );
      for (;;) {
        const step = await events.next();
        if (step.done) {
          return step.value;
        }
        if (!started) {
          observer?.firstToken();
        }
        started = true;
        yield step.value;
      }
    } catch (error) {
      if (started || !mayRetry(error, retry)) {
        const failure = toApiError(error, idleTimeoutMs) ?? error;
        if (isStreamFailure(error)) {
          observer?.streamFailed(oneLine((failure as Error).message));
        }
        throw failure;
      }
      observer?.retried();
      await backoff(retry);
    }
  }
}
