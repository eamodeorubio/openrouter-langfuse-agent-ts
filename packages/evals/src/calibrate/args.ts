/** The options a calibration command takes. */
export interface OptionSpec {
  /** Options that take a text: `--file x`. */
  values?: string[];
  /** Options that take a whole number from 1. */
  numbers?: string[];
  /** Options that stand alone. */
  flags?: string[];
  /** The name of the one argument that is no option, when the command takes it. Absent when it takes none. */
  positional?: string;
}

export interface Parsed {
  values: Record<string, string>;
  numbers: Record<string, number>;
  flags: Set<string>;
  positional: string | undefined;
}

/** The text as a whole number from 1, or undefined. */
const wholeNumber = (text: string): number | undefined => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 ? value : undefined;
};

/**
 * Reads the arguments of a command. Returns what it found, or the message
 * that explains the mistake, with the usage: an option it does not know, an
 * option with no value, a number that is not whole, a second positional
 * argument, or a positional one that is missing.
 */
export const parseArgs = (
  argv: string[],
  spec: OptionSpec,
  usage: string,
): Parsed | string => {
  const parsed: Parsed = {
    values: {},
    numbers: {},
    flags: new Set(),
    positional: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = argv[i + 1];
    if (spec.values?.includes(arg) && next !== undefined) {
      parsed.values[arg] = next;
      i++;
    } else if (spec.numbers?.includes(arg) && next !== undefined) {
      const value = wholeNumber(next);
      if (value === undefined) {
        return `${arg} takes a whole number from 1.\n${usage}`;
      }
      parsed.numbers[arg] = value;
      i++;
    } else if (spec.flags?.includes(arg)) {
      parsed.flags.add(arg);
    } else if (
      spec.positional !== undefined &&
      !arg.startsWith('-') &&
      parsed.positional === undefined
    ) {
      parsed.positional = arg;
    } else {
      return `Unexpected argument: ${arg}\n${usage}`;
    }
  }
  if (spec.positional !== undefined && parsed.positional === undefined) {
    return `The ${spec.positional} is missing.\n${usage}`;
  }
  return parsed;
};
