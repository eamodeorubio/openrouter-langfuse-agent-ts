import type { Usage } from './types.js';

/** The sum of a count that only some requests report: absent when neither does. */
const sumReported = (a: number | undefined, b: number | undefined) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** The sum of a figure that must come from every request, or it would understate the total. */
const sumComplete = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? undefined : a + b;

/**
 * The usage of two requests as one. A reasoning or cached count that neither
 * gives stays absent. A cost is kept only when both give one.
 */
export const addUsage = (a: Usage, b: Usage): Usage => ({
  promptTokens: a.promptTokens + b.promptTokens,
  completionTokens: a.completionTokens + b.completionTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  reasoningTokens: sumReported(a.reasoningTokens, b.reasoningTokens),
  cachedTokens: sumReported(a.cachedTokens, b.cachedTokens),
  cost: sumComplete(a.cost, b.cost),
});
