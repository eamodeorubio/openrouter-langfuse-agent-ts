import { UsageError } from './errors.js';

export interface Stdin {
  isTTY: boolean;
  read(): Promise<string>;
}

const nonBlank = (text: string, reason: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new UsageError(reason);
  }
  return trimmed;
};

export const readQuestion = async (
  flag: string | undefined,
  stdin: Stdin,
): Promise<string> => {
  if (flag !== undefined) {
    return nonBlank(
      flag,
      'The question given with -q is empty. Write the question after -q, or leave -q out and pipe the question in.',
    );
  }
  if (stdin.isTTY) {
    throw new UsageError(
      'No question given. Pass it with -q "your question", or pipe it in.',
    );
  }
  return nonBlank(
    await stdin.read(),
    'No question given. Standard input is empty. Pass -q "your question", or pipe the question in.',
  );
};
