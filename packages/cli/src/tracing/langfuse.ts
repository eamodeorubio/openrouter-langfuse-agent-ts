import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  type LangfuseAgent,
  type LangfuseSpanAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from '@langfuse/tracing';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { LangfuseConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { tokenBuckets } from './buckets.js';
import { createMask, redactorFor } from './mask.js';
import { toOpenAiMessages } from './messages.js';
import {
  type GenerationResult,
  type GenerationSpan,
  type GenerationStart,
  INTERRUPTED,
  NO_ROOT,
  type RootSpan,
  type ToolSpan,
  type Tracer,
} from './tracer.js';

/** What the traces call this tool, in place of anything taken from the machine. */
const SERVICE_NAME = 'openrouter-langfuse-agent-ts';

/** The longest the final flush may take. */
export const FLUSH_TIMEOUT_MS = 10_000;

export interface LangfuseTracerOptions {
  config: LangfuseConfig;
  /** Where spans go instead of Langfuse. Tests give an in-memory one. */
  exporter?: SpanExporter | undefined;
  /** Every string that must not leave the process. */
  secrets: readonly string[];
  /** The version of this tool, stamped on every observation. */
  version: string;
  /** Where the traces are filed. Langfuse's own default when absent. */
  environment?: string | undefined;
  /** What the traces are attributed to. The version when absent. */
  release?: string | undefined;
  flushTimeoutMs?: number;
}

/** The text of an error, and nothing that must stay secret. */
type Redact = (text: string) => string;

/** The value of `make`, or of `fallback` when `make` fails: a fault in tracing is the tracer's, never the caller's. */
const orElse = <T>(make: () => T, fallback: () => T): T => {
  try {
    return make();
  } catch {
    return fallback();
  }
};

/** Runs `work`; a fault in it is the tracer's, never the caller's. */
const quietly = (work: () => void): void => {
  try {
    work();
  } catch {
    // Tracing must not change the answer.
  }
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The reason a tool gave for failing: the `error` of its result, else the result. */
const reasonOf = (output: string): string => {
  const result = parsed(output);
  const reason = (result as { error?: unknown } | null)?.error;
  return typeof reason === 'string' ? reason : output;
};

const withTimeout = async (work: Promise<void>, ms: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const generationOutput = ({ text, thinking, toolCalls }: GenerationResult) => ({
  role: 'assistant',
  content: text || null,
  ...(thinking ? { reasoning: thinking } : {}),
  ...(toolCalls?.length
    ? {
        tool_calls: toolCalls.map(({ id, name, arguments: args }) => ({
          id,
          type: 'function',
          function: { name, arguments: args },
        })),
      }
    : {}),
});

/** Ends an observation because the run was cut short. */
type Abort = (reason: string) => void;

/**
 * Tracks an observation until it ends, once, by itself or by an abort,
 * whichever comes first. Gives the function that ends it by itself, and one that says whether it is still open.
 */
const lifecycle = (open: Set<Abort>, onAbort: Abort) => {
  const abort: Abort = (reason) => {
    // Stryker disable next-line ConditionalExpression: equivalent because OpenTelemetry ignores an update and a second end on an ended span, so an observation that was ended and is then aborted is still exported once, as it was.
    if (open.delete(abort)) {
      quietly(() => onAbort(reason));
    }
  };
  open.add(abort);
  const finish = (end: () => void): void => {
    // Stryker disable next-line ConditionalExpression: equivalent because OpenTelemetry ignores an update and a second end on an ended span, so an observation that was aborted and is then ended is still exported once, as it was.
    if (open.delete(abort)) {
      quietly(end);
    }
  };
  return [finish, () => open.has(abort)] as const;
};

/** Ends every observation still open, as an error with `reason`. */
const closeOpen = (open: Set<Abort>, reason: string): void => {
  for (const abort of [...open]) {
    abort(reason);
  }
};

/** Lets a run that was cut short go on running without recording more: the caller falls back to a span that does nothing. */
const refuseWhenAborted = ({ aborted }: Context): void => {
  if (aborted) {
    // The caller falls back to a span that does nothing and discards this.
    throw new Error();
  }
};

/** The W3C trace context that names `observation` as the parent of what is sent with it, sampled. */
const traceparentOf = ({
  traceId,
  id,
}: {
  traceId: string;
  id: string;
}): string => `00-${traceId}-${id}-01`;

/** The observation's own state: what it needs to record an error and to be told apart. */
interface Context {
  open: Set<Abort>;
  redact: Redact;
  version: string;
  /** Set by an abort: an observation asked for afterwards is not recorded. */
  aborted: boolean;
}

/** What a generation that failed records: the error and the retries. */
const failed = (error: string, redact: Redact, retries: number) => ({
  level: 'ERROR' as const,
  statusMessage: redact(error),
  metadata: retries ? { retries } : {},
});

/** What a generation that was answered records: the reply, the buckets, the cost, and the counts that did not fit. */
const succeeded = (
  result: GenerationResult,
  redact: Redact,
  retries: number,
) => {
  const buckets = result.usage && tokenBuckets(result.usage);
  return {
    model: result.model === undefined ? undefined : redact(result.model),
    output: generationOutput(result),
    usageDetails: buckets?.details,
    costDetails:
      typeof result.usage?.cost === 'number'
        ? { total: result.usage.cost }
        : undefined,
    metadata: {
      ...(result.finishReason ? { finish_reason: result.finishReason } : {}),
      ...buckets?.metadata,
      ...(retries ? { retries } : {}),
    },
  };
};

const generationSpan = (
  root: LangfuseAgent,
  { requestedModel, messages }: GenerationStart,
  context: Context,
): GenerationSpan => {
  const { open, redact, version } = context;
  refuseWhenAborted(context);
  const started = root.startObservation(
    'generate-response',
    {
      model: redact(requestedModel),
      input: toOpenAiMessages(messages),
      metadata: { requested_model: requestedModel },
      version,
    },
    { asType: 'generation' },
  );
  const [finish, isOpen] = lifecycle(open, (reason) => {
    started.update({ level: 'ERROR', statusMessage: redact(reason) });
    started.end();
  });
  let retries = 0;
  const traceparent = traceparentOf(started);
  const seen = new Set<string>();
  /** An instant on the generation, made once at the moment `at`, and only while the generation is open. */
  const instant = (
    name: string,
    attributes: LangfuseSpanAttributes,
    onFirst: (at: Date) => void = () => {},
  ) =>
    quietly(() => {
      if (isOpen() && !seen.has(name)) {
        seen.add(name);
        const at = new Date();
        onFirst(at);
        // The top-level call, not the child method of the SDK, because only it takes the time of the event.
        startObservation(
          name,
          { ...attributes, version },
          {
            asType: 'event',
            startTime: at,
            parentSpanContext: started.otelSpan.spanContext(),
          },
        );
      }
    });
  return {
    traceparent,
    retried: () => {
      retries += 1;
    },
    firstToken: () =>
      instant('receive-first-token', {}, (at) => {
        // Langfuse measures the time to first token from this, and it is the moment of the event.
        started.update({ completionStartTime: at });
      }),
    streamFailed: (message) =>
      instant('fail-stream', {
        level: 'ERROR',
        statusMessage: redact(message),
      }),
    end: (result) =>
      finish(() => {
        started.update(
          result.error === undefined
            ? succeeded(result, redact, retries)
            : failed(result.error, redact, retries),
        );
        started.end();
      }),
  };
};

const toolSpan = (
  root: LangfuseAgent,
  { name, arguments: args }: { name: string; arguments: string },
  context: Context,
): ToolSpan => {
  const { open, redact } = context;
  refuseWhenAborted(context);
  const started = root.startObservation(
    redact(name),
    { input: parsed(args), version: context.version },
    { asType: 'tool' },
  );
  const [finish] = lifecycle(open, (reason) => {
    started.update({ level: 'ERROR', statusMessage: redact(reason) });
    started.end();
  });
  return {
    traceparent: traceparentOf(started),
    end: ({ output, failed }) =>
      finish(() => {
        started.update({
          output,
          ...(failed
            ? { level: 'ERROR', statusMessage: redact(reasonOf(output)) }
            : {}),
        });
        started.end();
      }),
  };
};

const rootSpan = (question: string, context: Context): RootSpan => {
  const root = startObservation(
    'answer-question',
    { input: question, version: context.version },
    { asType: 'agent' },
  );
  const [finish] = lifecycle(context.open, (reason) => {
    root.update({ level: 'ERROR', statusMessage: context.redact(reason) });
    root.end();
  });
  return {
    traceId: root.traceId,
    generation: (start) =>
      orElse(
        () => generationSpan(root, start, context),
        () => NO_ROOT.generation(start),
      ),
    tool: (call) =>
      orElse(
        () => toolSpan(root, call, context),
        () => NO_ROOT.tool(call),
      ),
    end: ({ answer, error }) => {
      finish(() => {
        root.update(
          error === undefined
            ? { output: answer }
            : { level: 'ERROR', statusMessage: context.redact(error) },
        );
        root.end();
      });
      // A call still running when the run ends, such as a sibling of a tool that threw, would never be exported.
      closeOpen(context.open, error ?? INTERRUPTED);
    },
  };
};

/** The tracer that sends a run to Langfuse, through a provider of its own. */
export const createLangfuseTracer = ({
  config,
  exporter,
  secrets,
  version,
  environment = 'default',
  release = version,
  flushTimeoutMs = FLUSH_TIMEOUT_MS,
}: LangfuseTracerOptions): Tracer => {
  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    exporter,
    environment,
    release,
    mask: createMask(secrets),
  });
  setLangfuseTracerProvider(
    new NodeTracerProvider({
      // The default resource names the service after the path of the Node binary, which holds the user's home directory.
      resource: resourceFromAttributes({
        'service.name': SERVICE_NAME,
        'service.version': version,
      }),
      spanProcessors: [processor],
    }),
  );
  const context: Context = {
    open: new Set(),
    // The processor's mask does not reach the status message or the name of a tool.
    redact: redactorFor(secrets),
    version,
    aborted: false,
  };

  return {
    root: (question) =>
      orElse(
        () => rootSpan(question, context),
        () => NO_ROOT,
      ),
    abort: (reason) => {
      context.aborted = true;
      closeOpen(context.open, reason);
    },
    flush: async () => {
      try {
        await withTimeout(processor.forceFlush(), flushTimeoutMs);
      } catch {
        throw new ApiError(
          'The trace could not be delivered to Langfuse and may be incomplete.',
        );
      }
    },
  };
};
