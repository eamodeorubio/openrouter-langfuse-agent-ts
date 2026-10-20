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
    return nonBlank(flag, 'The question given with -q is empty.');
  }
  if (stdin.isTTY) {
    throw new UsageError('No question given. Pass -q or pipe the question in.');
  }
  return nonBlank(
    await stdin.read(),
    'No question given. Standard input is empty.',
  );
};
