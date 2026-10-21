import type { Completion } from './types.js';

export const formatStatus = ({ model, usage }: Completion): string => {
  const reasoning = usage.reasoningTokens
    ? ` (${usage.reasoningTokens} reasoning)`
    : '';
  return `model: ${model}\ntokens: ${usage.promptTokens} prompt, ${usage.completionTokens} completion${reasoning}, ${usage.totalTokens} total\n`;
};
