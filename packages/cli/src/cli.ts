import { parseCliArgs } from './args.js';
import { ask } from './ask.js';
import { loadConfig } from './config.js';
import { ApiError, ConfigError, LimitError, UsageError } from './errors.js';
import { readQuestion, type Stdin } from './input.js';
import { createPresenter } from './present.js';
import { redactKey } from './text.js';
import type { Sink } from './types.js';

export interface Io {
  cwd: string;
  stdin: Stdin;
  stdout: Sink;
  stderr: Sink;
  /** Where the API lives. Tests point it at a local server; the real entry point leaves it unset. */
  serverURL?: string;
}

const USAGE = `Usage: openrouter-langfuse-agent-ts [-q <question>] [--model <model>] [--thinking | --no-thinking] [--verbose]

  -q <question>   The question. Without it, the question is read from stdin.
  --model <model> The model that answers. Overrides OPENROUTER_MODEL.
  --thinking      Show the model's thinking on stderr, even when stderr is not a terminal.
  --no-thinking   Do not show the thinking, even on a terminal.
  --verbose       Show each tool call the model makes on stderr.

Environment: OPENROUTER_API_KEY (required), OPENROUTER_MODEL.`;

const EXIT_OK = 0;
const EXIT_USAGE_OR_CONFIG = 1;
const EXIT_API = 2;
const EXIT_LIMIT = 3;

export const run = async (
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
): Promise<number> => {
  let apiKey: string | undefined;
  let presenter: ReturnType<typeof createPresenter> | undefined;
  try {
    const args = parseCliArgs(argv);
    const config = await loadConfig(args, env, io.cwd);
    apiKey = config.apiKey;
    const question = await readQuestion(args.question, io.stdin);
    presenter = createPresenter({
      stdout: io.stdout,
      stderr: io.stderr,
      thinking: args.thinking,
      verbose: args.verbose,
      noColor: env.NO_COLOR,
    });
    for await (const event of ask(config, question, {
      serverURL: io.serverURL,
    })) {
      presenter.handle(event);
    }
    return EXIT_OK;
  } catch (error) {
    try {
      // Stryker disable next-line OptionalChaining: equivalent because the catch around it swallows the TypeError a missing presenter would throw.
      presenter?.interrupt();
    } catch {
      // The output is gone; the error line below still goes to stderr.
    }
    const fail = (message: string, code: number): number => {
      io.stderr.write(`${redactKey(message, apiKey)}\n`);
      return code;
    };
    if (error instanceof UsageError) {
      return fail(`${error.message}\n\n${USAGE}`, EXIT_USAGE_OR_CONFIG);
    }
    if (error instanceof ConfigError) {
      return fail(error.message, EXIT_USAGE_OR_CONFIG);
    }
    if (error instanceof LimitError) {
      return fail(error.message, EXIT_LIMIT);
    }
    if (error instanceof ApiError) {
      return fail(error.message, EXIT_API);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`Unexpected error: ${reason}`, EXIT_API);
  }
};
