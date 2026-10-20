import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

export interface CliArgs {
  question: string | undefined;
  model: string | undefined;
}

/**
 * `-q` takes the next argument as its value, whatever it starts with, so
 * `-q "-5 degrees"` is a question. `parseArgs` calls that ambiguous, but it
 * accepts the value attached to the flag (`-q-5 degrees`).
 */
const attachQuestionValues = (argv: string[]): string[] => {
  const attached: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = argv[i + 1];
    if (arg === '-q' && next?.startsWith('-')) {
      attached.push(`-q${next}`);
      i++;
    } else {
      attached.push(arg);
    }
  }
  return attached;
};

export const parseCliArgs = (argv: string[]): CliArgs => {
  try {
    const { values } = parseArgs({
      args: attachQuestionValues(argv),
      options: {
        q: { type: 'string', short: 'q' },
        model: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
    return { question: values.q, model: values.model };
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
};
