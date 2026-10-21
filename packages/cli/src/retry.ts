import { setTimeout as sleep } from 'node:timers/promises';
import {
  ConnectionError,
  OpenRouterError,
} from '@openrouter/sdk/models/errors';
import { ChunkError, StreamError } from './failures.js';

const MAX_RETRIES = 4;
const FIRST_WAIT_MS = 300;

const isRetryableStatus = (code: number): boolean =>
  code === 429 || code >= 500;

/** Failures worth another try: the network, a broken stream, HTTP 429 and 5xx. */
export const isTransient = (error: unknown): boolean =>
  error instanceof ConnectionError ||
  error instanceof StreamError ||
  (error instanceof ChunkError && isRetryableStatus(error.code)) ||
  (error instanceof OpenRouterError && isRetryableStatus(error.statusCode));

/** Whether failure number `retry + 1` (counting from 0) may be tried again. */
export const mayRetry = (error: unknown, retry: number): boolean =>
  retry < MAX_RETRIES && isTransient(error);

/** Waits before retry `retry` (0 is the first): doubling waits, each scaled by 0.75 to 1.25. */
export const backoff = (retry: number): Promise<void> =>
  sleep(FIRST_WAIT_MS * 2 ** retry * (0.75 + Math.random() * 0.5));

/** Runs `attempt` until it succeeds or fails for good. */
export const withRetry = async <T>(attempt: () => Promise<T>): Promise<T> => {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (!mayRetry(error, retry)) {
        throw error;
      }
      await backoff(retry);
    }
  }
};
