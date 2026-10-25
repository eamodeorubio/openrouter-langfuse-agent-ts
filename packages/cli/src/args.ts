import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

export interface CliArgs {
  question: string | undefined;
  model: string | undefined;
  /** `true` for --thinking, `false` for --no-thinking, `undefined` to decide from the terminal. */
  thinking: boolean | undefined;
  /** Show the tool calls on stderr. */
  verbose: boolean;
  /** Write one JSON object when the run has ended, and nothing else. */
  json: boolean;
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

/** The options of a run. The help text describes each of them. */
export const OPTIONS = {
  q: { type: 'string', short: 'q' },
  model: { type: 'string' },
  thinking: { type: 'boolean' },
  'no-thinking': { type: 'boolean' },
  verbose: { type: 'boolean' },
  json: { type: 'boolean' },
} as const;

/** The flags that print something and end the run, so they are no options of a run. */
const INFO: Record<string, 'help' | 'version'> = {
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
};

export const INFO_FLAGS = Object.keys(INFO);

/**
 * The options whose next argument is their value, whatever it looks like:
 * the string options of the parser, in both spellings. `attachQuestionValues`
 * follows the same rule for `-q`, and the two must agree.
 */
const TAKES_VALUE = new Set(
  Object.entries(OPTIONS).flatMap(([name, option]) =>
    option.type === 'string'
      ? [`--${name}`, ...('short' in option ? [`-${option.short}`] : [])]
      : [],
  ),
);

/**
 * Whether the arguments ask for the help or the version. Either wins over
 * every other argument, even one that would not parse, and help wins over
 * version. The value of `-q` or `--model` is no flag: `-q --help` is a question.
 */
export const requestedInfo = (
  argv: string[],
): 'help' | 'version' | undefined => {
  let found: 'help' | 'version' | undefined;
  let isValue = false;
  for (const arg of argv) {
    if (isValue) {
      isValue = false;
    } else if (TAKES_VALUE.has(arg)) {
      isValue = true;
    } else if (INFO[arg] === 'help') {
      return 'help';
    } else if (INFO[arg] === 'version') {
      found = 'version';
    }
  }
  return found;
};

const QUESTION_NEEDS_VALUE =
  '-q needs a value, the question. Example: -q "What is a token?". Or leave -q out and pipe the question in.';
const MODEL_NEEDS_VALUE =
  '--model needs a value, a model slug. Example: --model openai/gpt-4o-mini';

/** The first thing the parser quotes in a message: `'--bogus'` in `Unknown option '--bogus'`. */
const quoted = (message: string): string | undefined =>
  /'(.*?)'(?=[.\s]|$)/.exec(message)?.[1];

/**
 * Words of our own for what `parseArgs` rejected: it names `-q, --q <value>`
 * and offers `--model=-XYZ`. A failure it has no code for keeps its message,
 * so that a newer Node cannot hide one.
 */
export const usageErrorOf = (error: unknown): UsageError => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const arg = quoted(message);
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && arg !== undefined) {
    return new UsageError(
      `Unknown option '${arg}'. The options this tool accepts are listed below.`,
    );
  }
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' && arg !== undefined) {
    return new UsageError(
      `Unexpected argument '${arg}'. Quote the question and pass it with -q, or pipe it in.`,
    );
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const flag = /--([\w-]+)/.exec(message)?.[1];
    if (message.includes('does not take an argument') && flag) {
      return new UsageError(`--${flag} takes no value. Write --${flag} alone.`);
    }
    if (flag === 'q') {
      return new UsageError(QUESTION_NEEDS_VALUE);
    }
    if (flag === 'model') {
      return new UsageError(MODEL_NEEDS_VALUE);
    }
  }
  return new UsageError(message);
};

export const parseCliArgs = (argv: string[]): CliArgs => {
  try {
    const { values } = parseArgs({
      args: attachQuestionValues(argv),
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    if (values.thinking && values['no-thinking']) {
      throw new UsageError(
        'Use either --thinking or --no-thinking, not both. Remove one.',
      );
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
      json: Boolean(values.json),
    };
  } catch (error) {
    throw error instanceof UsageError ? error : usageErrorOf(error);
  }
};
