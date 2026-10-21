import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

export interface CliArgs {
  question: string | undefined;
  model: string | undefined;
  /** `true` for --thinking, `false` for --no-thinking, `undefined` to decide from the terminal. */
  thinking: boolean | undefined;
  /** Show the tool calls on stderr. */
  verbose: boolean;
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
        thinking: { type: 'boolean' },
        'no-thinking': { type: 'boolean' },
        verbose: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.thinking && values['no-thinking']) {
      throw new UsageError('Use either --thinking or --no-thinking, not both.');
    }
    let thinking: boolean | undefined;
    if (values.thinking) {
      thinking = true;
    } else if (values['no-thinking']) {
      thinking = false;
    }
    return {
      question: values.q,
      model: values.model,
      thinking,
      verbose: Boolean(values.verbose),
    };
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
};
