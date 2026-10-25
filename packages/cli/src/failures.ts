import { STATUS_CODES } from 'node:http';
import {
  HTTPClientError,
  OpenRouterError,
  RequestTimeoutError,
  SDKValidationError,
} from '@openrouter/sdk/models/errors';
import { z } from 'zod';
import { ApiError, TimeoutError } from './errors.js';
import { oneLine } from './text.js';

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

export const isShapeError = (error: unknown): boolean =>
  // The SDK makes `instanceof SDKValidationError` match a ResponseValidationError too.
  error instanceof SDKValidationError ||
  // A malformed chunk in a stream escapes the SDK as a bare ZodError, which
  // is not one of its classes and whose message is a long validation dump.
  (error instanceof Error && error.name === 'ZodError');

const TRY_AGAIN = ' Try again, or choose another model.';

/** What the user can do about a failed request, by the status the service gave. Empty when nothing helps. */
const remedyFor = (status: number): string => {
  if (status === 401 || status === 403) {
    return ' Check OPENROUTER_API_KEY.';
  }
  if (status === 402) {
    return ' Add credits at https://openrouter.ai/settings/credits.';
  }
  if (status === 404) {
    return ' If the model is unknown, check the slug passed with --model or set in OPENROUTER_MODEL.';
  }
  if (status === 429) {
    return ' Wait a moment and try again.';
  }
  return status >= 500 && status <= 599
    ? ' OpenRouter is having trouble. Try again later.'
    : '';
};

/** What the client library writes when it cannot unpack the body: it quotes the status, the content type and the body. */
const LIBRARY_WRAPPER = /^API error occurred/;

const bodyWithMessage = z.object({
  error: z.object({ message: z.string().trim().min(1) }),
});

/** The `error.message` of a JSON body, if that is what the body holds. */
const messageInBody = (body: string): string | undefined => {
  try {
    const result = bodyWithMessage.safeParse(JSON.parse(body));
    return result.success ? result.data.error.message : undefined;
    // Stryker disable next-line BlockStatement: equivalent because an empty catch leaves the function to return undefined, as the catch does.
  } catch {
    return undefined;
  }
};

/**
 * What the service said, without the library's wrapper around it. A body that
 * is no message, such as a web page, gives the standard reason of the status.
 */
const saidBy = (error: OpenRouterError): string =>
  LIBRARY_WRAPPER.test(error.message)
    ? (messageInBody(error.body) ??
      STATUS_CODES[error.statusCode] ??
      'Unknown error')
    : error.message;

/** The service's words for a failed request, with the remedy for its status. */
const serviceError = (status: number, message: string): ApiError =>
  new ApiError(`API error ${status}: ${oneLine(message)}${remedyFor(status)}`);

/**
 * The `ApiError` that tells the user what went wrong, or `undefined` for an
 * error this module does not know (a bug), which the caller then rethrows.
 */
export const toApiError = (
  error: unknown,
  idleTimeoutMs: number,
): ApiError | undefined => {
  if (error instanceof IdleTimeout) {
    return new TimeoutError(
      `Request timed out: no data for ${idleTimeoutMs / 1000} s.${TRY_AGAIN}`,
    );
  }
  if (error instanceof ChunkError) {
    return serviceError(error.code, error.message);
  }
  if (isShapeError(error)) {
    return new ApiError(
      `OpenRouter sent a reply this tool could not read.${TRY_AGAIN}`,
    );
  }
  if (error instanceof OpenRouterError) {
    return serviceError(error.statusCode, saidBy(error));
  }
  if (error instanceof StreamError) {
    return new ApiError(
      'The connection to OpenRouter dropped before the answer was complete.',
    );
  }
  if (error instanceof RequestTimeoutError) {
    return new TimeoutError(`The request to OpenRouter timed out.${TRY_AGAIN}`);
  }
  // Stryker disable next-line ConditionalExpression: equivalent because every error the SDK call throws is an HTTPClientError or an OpenRouterError; the fall-through guards SDK bugs and no test can reach it.
  if (error instanceof HTTPClientError) {
    return new ApiError(
      'Cannot reach OpenRouter. Check your network connection and try again.',
    );
  }
  return undefined;
};
