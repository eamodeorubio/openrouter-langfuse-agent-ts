import type { ModelsListResponse } from '@openrouter/sdk/models';
import type { ToolResult } from './types.js';

/** A model as the models API lists it. */
export type CatalogModel = ModelsListResponse['data'][number];

/**
 * The matches of one set of API filters, read once. A call that starts while
 * the first is still fetching waits for it, so calls of one round that ask the
 * same filters make one request. A fetch that failed is dropped, so that the
 * next call tries again. The read runs under the deadline of the call that
 * started it, and a call that waits on it shares its failure.
 */
export interface CatalogCache {
  /** Returns what an earlier call fetched for `key`, or runs `fetch` and keeps its value when it succeeds. */
  read(key: string, fetch: () => Promise<ToolResult>): Promise<ToolResult>;
}

export const createCatalogCache = (): CatalogCache => {
  const kept = new Map<string, Promise<ToolResult>>();
  return {
    read(key, fetch) {
      const earlier = kept.get(key);
      if (earlier) {
        return earlier;
      }
      const started = fetch().then(
        (result) => {
          if (!result.ok) {
            kept.delete(key);
          }
          return result;
        },
        (error: unknown) => {
          kept.delete(key);
          throw error;
        },
      );
      kept.set(key, started);
      return started;
    },
  };
};
