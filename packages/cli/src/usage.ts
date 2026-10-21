import type { Usage } from './types.js';

/** The usage of two requests as one. A reasoning count that neither gives stays absent. */
export const addUsage = (a: Usage, b: Usage): Usage => ({
  promptTokens: a.promptTokens + b.promptTokens,
  completionTokens: a.completionTokens + b.completionTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  reasoningTokens:
    a.reasoningTokens === undefined && b.reasoningTokens === undefined
      ? undefined
      : (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
});
