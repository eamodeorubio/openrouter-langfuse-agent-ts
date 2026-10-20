import { setTimeout as sleep } from 'node:timers/promises';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatResult } from '@openrouter/sdk/models';
import {
  ConnectionError,
  HTTPClientError,
  OpenRouterError,
  ResponseValidationError,
} from '@openrouter/sdk/models/errors';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import type { Answer } from './types.js';

const TIMEOUT_MS = 60_000;
const MAX_MESSAGE_LENGTH = 200;
const MAX_RETRIES = 4;
const FIRST_WAIT_MS = 300;

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_MESSAGE_LENGTH
    ? `${line.slice(0, MAX_MESSAGE_LENGTH)}…`
    : line;
};

const toApiError = (error: unknown): ApiError | undefined => {
  if (error instanceof ResponseValidationError) {
    return new ApiError('The API response did not have the expected shape.');
  }
  if (error instanceof OpenRouterError) {
    return new ApiError(
      `API error ${error.statusCode}: ${oneLine(error.message)}`,
    );
  }
  // Stryker disable next-line ConditionalExpression: equivalent because every error the SDK call throws is an HTTPClientError or an OpenRouterError; the fall-through guards SDK bugs and no test can reach it.
  if (error instanceof HTTPClientError) {
    return new ApiError(`Request failed: ${oneLine(error.message)}`);
  }
  return undefined;
};

const isTransient = (error: unknown): boolean =>
  error instanceof ConnectionError ||
  (error instanceof OpenRouterError &&
    (error.statusCode === 429 || error.statusCode >= 500));

/** Retries a transient failure with doubling waits, each scaled by 0.75 to 1.25. */
const withRetries = async <T>(send: () => Promise<T>): Promise<T> => {
  for (let retry = 0; ; retry++) {
    try {
      return await send();
    } catch (error) {
      if (retry >= MAX_RETRIES || !isTransient(error)) {
        throw error;
      }
      await sleep(FIRST_WAIT_MS * 2 ** retry * (0.75 + Math.random() * 0.5));
    }
  }
};

/** Test seams: a short timeout and a local server. `run` never sets them. */
export interface AskOptions {
  timeoutMs?: number;
  serverURL?: string;
}

export const ask = async (
  { apiKey, model }: Config,
  question: string,
  { timeoutMs = TIMEOUT_MS, serverURL }: AskOptions = {},
): Promise<Answer> => {
  // The SDK's own retry cannot express our policy (see withRetries) and runs for an hour by default.
  const client = new OpenRouter({
    apiKey,
    retryConfig: { strategy: 'none' },
    timeoutMs,
    serverURL,
  });
  let response: ChatResult;
  try {
    // Without `stream: true` the SDK returns a ChatResult; the type also admits an event stream.
    response = await withRetries(
      async () =>
        (await client.chat.send({
          chatRequest: {
            model,
            messages: [{ role: 'user', content: question }],
          },
        })) as ChatResult,
    );
  } catch (error) {
    throw toApiError(error) ?? error;
  }

  const text = response.choices[0]?.message.content;
  if (typeof text !== 'string' || text === '') {
    throw new ApiError('The API response held no answer.');
  }
  // The SDK already rejects a usage object that lacks any of its three counts.
  const { usage } = response;
  if (!usage) {
    throw new ApiError('The API response held no token usage.');
  }
  return {
    text,
    model: response.model,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
  };
};
