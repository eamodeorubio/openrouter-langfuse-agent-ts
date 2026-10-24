import type { Usage } from '../types.js';

/** What a generation reports: the buckets Langfuse stores, and the counts that did not fit them. */
export interface TokenBuckets {
  details: Record<string, number>;
  metadata: Record<string, number>;
}

/**
 * Takes `part` out of `whole`, the way a provider counts cached tokens inside
 * the prompt and reasoning tokens inside the completion. A part that is
 * larger than its whole cannot be inside it: the whole stays whole and the
 * odd count is handed back to be kept elsewhere.
 */
const split = (
  whole: number,
  part: number | undefined,
): { rest: number; part?: number; odd?: number } =>
  part === undefined || part > whole
    ? { rest: whole, odd: part }
    : { rest: whole - part, part };

/**
 * Langfuse stores every key as a bucket of its own, so a token must be in
 * exactly one. `total` is the sum of the buckets, which keeps the sums true
 * whatever a provider reports.
 */
export const tokenBuckets = ({
  promptTokens,
  completionTokens,
  cachedTokens,
  reasoningTokens,
}: Usage): TokenBuckets => {
  const prompt = split(promptTokens, cachedTokens);
  const completion = split(completionTokens, reasoningTokens);
  const details: Record<string, number> = { input: prompt.rest };
  if (prompt.part !== undefined) {
    details.input_cached_tokens = prompt.part;
  }
  details.output = completion.rest;
  if (completion.part !== undefined) {
    details.output_reasoning_tokens = completion.part;
  }
  details.total = Object.values(details).reduce((sum, count) => sum + count, 0);
  const metadata: Record<string, number> = {};
  if (prompt.odd !== undefined) {
    metadata.cached_tokens = prompt.odd;
  }
  if (completion.odd !== undefined) {
    metadata.reasoning_tokens = completion.odd;
  }
  return { details, metadata };
};
