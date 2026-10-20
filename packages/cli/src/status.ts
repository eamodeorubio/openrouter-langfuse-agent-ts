import type { Answer } from './types.js';

export const formatStatus = ({
  model,
  usage,
}: Pick<Answer, 'model' | 'usage'>): string =>
  `model: ${model}\ntokens: ${usage.promptTokens} prompt, ${usage.completionTokens} completion, ${usage.totalTokens} total\n`;
