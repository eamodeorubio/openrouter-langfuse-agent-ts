import { parseCliArgs } from './args.js';
import { ask } from './ask.js';
import { classify, EXIT_API, EXIT_OK } from './classify.js';
import { createCollector } from './collector.js';
import { type Config, loadConfig } from './config.js';
import { UsageError } from './errors.js';
import { readQuestion, type Stdin } from './input.js';
import { serialize } from './output.js';
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
  /** Test seam: how long the API may stay silent, in milliseconds. The real entry point leaves it unset. */
  idleTimeoutMs?: number;
  /** Aborted with `SIGINT` or `SIGTERM` when the process is told to stop. */
  signal?: AbortSignal;
  /** Test seams for tracing. The real entry point leaves it unset. */
  tracing?: TracingOptions;
}

const USAGE = `Usage: openrouter-langfuse-agent-ts [-q <question>] [--model <model>] [--thinking | --no-thinking] [--verbose] [--json]

  -q <question>   The question. Without it, the question is read from stdin.
  --model <model> The model that answers. Overrides OPENROUTER_MODEL.
  --thinking      Show the model's thinking on stderr, even when stderr is not a terminal.
  --no-thinking   Do not show the thinking, even on a terminal.
  --verbose       Show each tool call the model makes on stderr.
  --json          Write one JSON object when the run ends: to stdout on success, to stderr on failure.

Environment: OPENROUTER_API_KEY (required), OPENROUTER_MODEL.
Tracing: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL, all or none.`;

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
  /** Set once `--json` is known: the run writes one object, and `run` writes the loss of a trace as one. */
  collector?: ReturnType<typeof createCollector> | undefined;
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
    const message = (error as Error).message;
    // A failed run has written its object; a second would break the rule of one per stream.
    if (!session.collector) {
      io.stderr.write(`${message}\n`);
    } else if (code === EXIT_OK) {
      io.stderr.write(
        serialize(
          session.collector.failure({ code: 'TRACE_FLUSH_FAILED', message }),
        ),
      );
    }
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
  // Arguments that do not parse still get the format they asked for. Once
  // parsed, they have the last word: `-q --json` is a question, not a flag.
  if (argv.includes('--json')) {
    session.collector = createCollector();
  }
  try {
    const args = parseCliArgs(argv);
    if (!args.json) {
      session.collector = undefined;
    }
    config = await loadConfig(args, env, io.cwd);
    if (config.langfuse) {
      session.tracer = await openTracer(
        config.apiKey,
        config.langfuse,
        io.tracing,
      );
    } else if (!session.collector) {
      io.stderr.write(NOT_TRACED);
    }
    const question = await readQuestion(args.question, io.stdin);
    session.collector?.setQuestion(question);
    presenter = session.collector
      ? undefined
      : createPresenter({
          stdout: io.stdout,
          stderr: io.stderr,
          thinking: args.thinking,
          verbose: args.verbose,
          noColor: env.NO_COLOR,
        });
    for await (const event of ask(config, question, {
      serverURL: io.serverURL,
      idleTimeoutMs: io.idleTimeoutMs,
      tracer: session.tracer,
    })) {
      // Stryker disable next-line OptionalChaining: equivalent because the presenter is set whenever there is no collector; the optional chain only satisfies the type.
      (session.collector ?? presenter)?.handle(event);
    }
    if (session.collector) {
      io.stdout.write(serialize(session.collector.success()));
    }
    return EXIT_OK;
  } catch (error) {
    try {
      // Stryker disable next-line OptionalChaining: equivalent because the catch around it swallows the TypeError a missing presenter would throw.
      presenter?.interrupt();
    } catch {
      // The output is gone; the error line below still goes to stderr.
    }
    const failure = classify(error);
    const message = redactAll(failure.message, secretsOf(config));
    if (session.collector) {
      io.stderr.write(
        serialize(session.collector.failure({ code: failure.code, message })),
      );
    } else {
      const usage = error instanceof UsageError ? `\n\n${USAGE}` : '';
      io.stderr.write(`${message}${usage}\n`);
    }
    return failure.exit;
  }
};
