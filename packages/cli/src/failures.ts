import {
  ConnectionError,
  HTTPClientError,
  OpenRouterError,
  ResponseValidationError,
  SDKValidationError,
} from '@openrouter/sdk/models/errors';
import { ApiError } from './errors.js';

const MAX_MESSAGE_LENGTH = 200;

/** No chunk arrived in time. */
export class IdleTimeout extends Error {}

/** A chunk that carries an `error`, as a provider sends one mid-stream. */
export class ChunkError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** The stream broke while we were reading it (a dropped connection, for one). */
export class StreamError extends Error {}

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_MESSAGE_LENGTH
    ? `${line.slice(0, MAX_MESSAGE_LENGTH)}…`
    : line;
};

export const isShapeError = (error: unknown): boolean =>
  error instanceof ResponseValidationError ||
  error instanceof SDKValidationError ||
  // A malformed chunk in a stream escapes the SDK as a bare ZodError, which
  // is not one of its classes and whose message is a long validation dump.
  (error instanceof Error && error.name === 'ZodError');

/**
 * The `ApiError` that tells the user what went wrong, or `undefined` for an
 * error this module does not know (a bug), which the caller then rethrows.
 */
export const toApiError = (
  error: unknown,
  idleTimeoutMs: number,
): ApiError | undefined => {
  if (error instanceof IdleTimeout) {
    return new ApiError(
      `Request timed out: no data for ${idleTimeoutMs / 1000} s.`,
    );
  }
  if (error instanceof ChunkError) {
    return new ApiError(`API error ${error.code}: ${oneLine(error.message)}`);
  }
  if (isShapeError(error)) {
    return new ApiError('The API response did not have the expected shape.');
  }
  if (error instanceof OpenRouterError) {
    return new ApiError(
      `API error ${error.statusCode}: ${oneLine(error.message)}`,
    );
  }
  if (error instanceof StreamError) {
    return new ApiError(`Stream failed: ${oneLine(error.message)}`);
  }
  // Stryker disable next-line ConditionalExpression: equivalent because every error the SDK call throws is an HTTPClientError or an OpenRouterError; the fall-through guards SDK bugs and no test can reach it.
  if (error instanceof HTTPClientError) {
    return new ApiError(`Request failed: ${oneLine(error.message)}`);
  }
  return undefined;
};

const isRetryableStatus = (code: number): boolean =>
  code === 429 || code >= 500;

export const isTransient = (error: unknown): boolean =>
  error instanceof ConnectionError ||
  error instanceof StreamError ||
  (error instanceof ChunkError && isRetryableStatus(error.code)) ||
  (error instanceof OpenRouterError && isRetryableStatus(error.statusCode));
