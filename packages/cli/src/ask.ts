import { setTimeout as sleep } from 'node:timers/promises';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatStreamChunk } from '@openrouter/sdk/models';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import {
  ChunkError,
  IdleTimeout,
  isShapeError,
  isTransient,
  StreamError,
  toApiError,
} from './failures.js';
import type { AskEvent } from './types.js';

const IDLE_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 4;
const FIRST_WAIT_MS = 300;

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
  model: string,
  question: string,
  idleTimeoutMs: number,
): AsyncGenerator<ChatStreamChunk, void> {
  const controller = new AbortController();
  const sentAt = Date.now();
  let iterator: AsyncIterator<ChatStreamChunk> | undefined;
  try {
    // Our own signal switches the SDK's whole-request deadline off. The SDK's
    // iterator ignores an abort, so the race below ends the wait; the abort only frees the socket.
    let response: Awaited<ReturnType<typeof client.chat.send>>;
    try {
      response = await within(
        client.chat.send(
          {
            chatRequest: {
              model,
              stream: true,
              messages: [{ role: 'user', content: question }],
            },
          },
          { signal: controller.signal },
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
    // With `stream: true` the SDK returns an event stream; its type also admits a plain result.
    iterator = (response as unknown as AsyncIterable<ChatStreamChunk>)[
      Symbol.asyncIterator
    ]();
    let limit = Math.max(0, idleTimeoutMs - (Date.now() - sentAt));
    for (;;) {
      let step: IteratorResult<ChatStreamChunk>;
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

/** One request, read to the end, turned into events. */
async function* attempt(
  client: OpenRouter,
  model: string,
  question: string,
  idleTimeoutMs: number,
): AsyncGenerator<AskEvent, void> {
  let sawAnswer = false;
  // Stryker disable next-line StringLiteral: equivalent because the first chunk replaces it before it is read, and a stream without chunks fails before it is used.
  let servedModel = '';
  let usage: ChatStreamChunk['usage'];
  for await (const chunk of readChunks(
    client,
    model,
    question,
    idleTimeoutMs,
  )) {
    if (chunk.error) {
      throw new ChunkError(chunk.error.code, chunk.error.message);
    }
    servedModel = chunk.model;
    const delta = chunk.choices[0]?.delta;
    if (delta?.reasoning) {
      yield { kind: 'thinking', text: delta.reasoning };
    }
    if (delta?.content) {
      sawAnswer = true;
      yield { kind: 'content', text: delta.content };
    }
    usage = chunk.usage ?? usage;
  }

  if (!sawAnswer) {
    throw new ApiError('The API response held no answer.');
  }
  if (!usage) {
    throw new ApiError('The API response held no token usage.');
  }
  yield {
    kind: 'done',
    model: servedModel,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens:
        usage.completionTokensDetails?.reasoningTokens ?? undefined,
    },
  };
}

/** Test seams: a short idle limit (never set by `run`) and a local server (`run` forwards its `Io.serverURL`; production leaves it unset). */
export interface AskOptions {
  idleTimeoutMs?: number;
  serverURL?: string;
}

/**
 * Asks the model one question and yields the answer as it arrives. A
 * transient failure is retried with doubling waits (each scaled by 0.75 to
 * 1.25), but only while nothing has been yielded: after that a retry would
 * repeat text the caller has already seen.
 */
export async function* ask(
  { apiKey, model }: Config,
  question: string,
  { idleTimeoutMs = IDLE_TIMEOUT_MS, serverURL }: AskOptions = {},
): AsyncGenerator<AskEvent, void> {
  // The SDK's own retry cannot express our policy and runs for an hour by default.
  const client = new OpenRouter({
    apiKey,
    // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent because the SDK retries only for the strategy "backoff"; any other value, an empty one included, is one attempt. The explicit 'none' is for the reader.
    retryConfig: { strategy: 'none' },
    serverURL,
  });
  for (let retry = 0; ; retry++) {
    let started = false;
    try {
      for await (const event of attempt(
        client,
        model,
        question,
        idleTimeoutMs,
      )) {
        started = true;
        yield event;
      }
      return;
    } catch (error) {
      if (started || retry >= MAX_RETRIES || !isTransient(error)) {
        throw toApiError(error, idleTimeoutMs) ?? error;
      }
      await sleep(FIRST_WAIT_MS * 2 ** retry * (0.75 + Math.random() * 0.5));
    }
  }
}
