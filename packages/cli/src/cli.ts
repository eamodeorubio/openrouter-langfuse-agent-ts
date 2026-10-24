import { parseCliArgs } from './args.js';
import { ask } from './ask.js';
import { type Config, loadConfig } from './config.js';
import { ApiError, ConfigError, LimitError, UsageError } from './errors.js';
import { readQuestion, type Stdin } from './input.js';
import { createPresenter } from './present.js';
import { redactAll } from './text.js';
import { openTracer, type TracingOptions } from './tracing/create.js';
import { INTERRUPTED, NO_TRACER, type Tracer } from './tracing/tracer.js';
import type { Sink } from './types.js';

export interface Io {
  cwd: string;
  stdin: Stdin;
  stdout: Sink;
  stderr: Sink;
  /** Where the API lives. Tests point it at a local server; the real entry point leaves it unset. */
  serverURL?: string;
  /** Aborted with `SIGINT` or `SIGTERM` when the process is told to stop. */
  signal?: AbortSignal;
  /** Test seams for tracing. The real entry point leaves it unset. */
  tracing?: TracingOptions;
}

const USAGE = `Usage: openrouter-langfuse-agent-ts [-q <question>] [--model <model>] [--thinking | --no-thinking] [--verbose]

  -q <question>   The question. Without it, the question is read from stdin.
  --model <model> The model that answers. Overrides OPENROUTER_MODEL.
  --thinking      Show the model's thinking on stderr, even when stderr is not a terminal.
  --no-thinking   Do not show the thinking, even on a terminal.
  --verbose       Show each tool call the model makes on stderr.

Environment: OPENROUTER_API_KEY (required), OPENROUTER_MODEL.
Tracing: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL, all or none.`;

const EXIT_OK = 0;
const EXIT_USAGE_OR_CONFIG = 1;
const EXIT_API = 2;
const EXIT_LIMIT = 3;

/** The one line an untraced run writes to stderr. */
export const NOT_TRACED = `Langfuse tracing is off: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL are not set.\n`;

/** The exit code once the trace has been sent, or has failed to be: a lost trace fails a clean run and never softens a failed one. */
export const afterFlush = (code: number, flushFailed: boolean): number =>
  flushFailed && code === EXIT_OK ? EXIT_API : code;

/** Every key a message must not show. A key not yet known is `undefined`. */
const secretsOf = (config: Config | undefined) => [
  config?.apiKey,
  config?.langfuse?.publicKey,
  config?.langfuse?.secretKey,
];

/** What `execute` leaves behind for `run` to settle. */
interface Session {
  tracer: Tracer;
}

/** What a shell reports for a process a signal killed: 128 plus the signal number. */
const SIGNAL_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };

/**
 * Resolves with the exit code of the signal that aborts `signal`, if one does.
 * The observations still open are closed first, so that the flush has them,
 * and the tracer records nothing more. The loop itself is not stopped: the
 * process exits as soon as `run` returns, which is what ends it.
 */
const whenInterrupted = (
  signal: AbortSignal | undefined,
  session: Session,
): Promise<number> =>
  new Promise((resolve) => {
    signal?.addEventListener('abort', () => {
      session.tracer.abort(INTERRUPTED);
      resolve(SIGNAL_CODES[String(signal.reason)] ?? 130);
    });
  });

export const run = async (
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
): Promise<number> => {
  const session: Session = { tracer: NO_TRACER };
  const code = await Promise.race([
    execute(argv, env, io, session),
    whenInterrupted(io.signal, session),
  ]);
  try {
    await session.tracer.flush();
    return code;
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n`);
    return afterFlush(code, true);
  }
};

const execute = async (
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
  session: Session,
): Promise<number> => {
  let config: Config | undefined;
  let presenter: ReturnType<typeof createPresenter> | undefined;
  try {
    const args = parseCliArgs(argv);
    config = await loadConfig(args, env, io.cwd);
    if (config.langfuse) {
      session.tracer = await openTracer(
        config.apiKey,
        config.langfuse,
        io.tracing,
      );
    } else {
      io.stderr.write(NOT_TRACED);
    }
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
      tracer: session.tracer,
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
      io.stderr.write(`${redactAll(message, secretsOf(config))}\n`);
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
