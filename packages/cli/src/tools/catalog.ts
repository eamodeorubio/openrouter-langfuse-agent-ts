import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { toApiError } from '../failures.js';
import { withRetry } from '../retry.js';
import type { ToolResult } from './types.js';

/** A tool call has a deadline for the whole call, never one for silence. Only an idle timeout reads this, and a tool call cannot raise one; if a bug did, its message would be wrong. */
const NO_IDLE_LIMIT = 0;

interface CatalogCall {
  /** What to tell the model when the API answers 404. Without it a 404 is an API error like any other. */
  notFound?: string;
}

/**
 * Calls the models API, retrying what is worth retrying, and gives the value
 * to `shape`. An expected failure (a 404, a bad status, a timeout, a dropped
 * connection) becomes a result for the model. Anything else is a bug and is
 * thrown.
 */
export const callCatalog = async <T>(
  call: () => Promise<T>,
  shape: (value: T) => unknown,
  { notFound }: CatalogCall = {},
): Promise<ToolResult> => {
  try {
    return { ok: true, value: shape(await withRetry(call)) };
  } catch (error) {
    if (
      notFound !== undefined &&
      error instanceof OpenRouterError &&
      error.statusCode === 404
    ) {
      return { ok: false, message: notFound };
    }
    const known = toApiError(error, NO_IDLE_LIMIT);
    if (known) {
      return { ok: false, message: known.message };
    }
    throw error;
  }
};
