import { parseCliArgs } from './args.js';
import { ask } from './ask.js';
import { loadConfig } from './config.js';
import { ApiError, ConfigError, UsageError } from './errors.js';
import { readQuestion, type Stdin } from './input.js';
import { formatStatus } from './status.js';

export interface Io {
  cwd: string;
  stdin: Stdin;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

const USAGE = `Usage: openrouter-langfuse-agent-ts [-q <question>] [--model <model>]

  -q <question>   The question. Without it, the question is read from stdin.
  --model <model> The model that answers. Overrides OPENROUTER_MODEL.

Environment: OPENROUTER_API_KEY (required), OPENROUTER_MODEL.`;

const EXIT_OK = 0;
const EXIT_USAGE_OR_CONFIG = 1;
const EXIT_API = 2;

/** The one place that keeps the API key off the screen, whatever failed. */
const redact = (text: string, apiKey: string | undefined): string =>
  apiKey ? text.replaceAll(apiKey, '[redacted]') : text;

export const run = async (
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
): Promise<number> => {
  let apiKey: string | undefined;
  try {
    const args = parseCliArgs(argv);
    const config = await loadConfig(args, env, io.cwd);
    apiKey = config.apiKey;
    const question = await readQuestion(args.question, io.stdin);
    const answer = await ask(config, question);
    io.stdout.write(`${answer.text}\n`);
    io.stderr.write(formatStatus(answer));
    return EXIT_OK;
  } catch (error) {
    const fail = (message: string, code: number): number => {
      io.stderr.write(`${redact(message, apiKey)}\n`);
      return code;
    };
    if (error instanceof UsageError) {
      return fail(`${error.message}\n\n${USAGE}`, EXIT_USAGE_OR_CONFIG);
    }
    if (error instanceof ConfigError) {
      return fail(error.message, EXIT_USAGE_OR_CONFIG);
    }
    if (error instanceof ApiError) {
      return fail(error.message, EXIT_API);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`Unexpected error: ${reason}`, EXIT_API);
  }
};
