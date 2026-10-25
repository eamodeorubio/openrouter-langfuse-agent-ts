import type { ChatMessages } from '@openrouter/sdk/models';
import type { ToolCall } from '../assemble.js';
import type { Usage } from '../types.js';

/** The status message of an observation the run left open when it was cut short. */
export const INTERRUPTED = 'The run was interrupted.';

/** What a request to the model holds when it opens. */
export interface GenerationStart {
  /** The model the user asked for. The one that serves it may differ. */
  requestedModel: string;
  messages: ChatMessages[];
}

/** How a request to the model ended. */
export interface GenerationResult {
  /** The model that served it. */
  model?: string | undefined;
  text?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
  thinking?: string | undefined;
  finishReason?: string | undefined;
  usage?: Usage | undefined;
  /** The response held answer text and no tool calls: the text the user gets. */
  final?: boolean | undefined;
  /** One line. Present when the request failed. */
  error?: string | undefined;
}

export interface GenerationSpan {
  /** The W3C trace context of this request, to send with it. Absent when nothing is recorded. */
  readonly traceparent: string | undefined;
  /** A failed attempt was repeated. */
  retried(): void;
  /** The first text or thinking arrived. Recorded once. */
  firstToken(): void;
  /** The stream failed and the request ends with it. Recorded once. */
  streamFailed(message: string): void;
  end(result: GenerationResult): void;
}

export interface ToolSpan {
  /** The W3C trace context of this call, to send with its requests. Absent when nothing is recorded. */
  readonly traceparent: string | undefined;
  /** `output` is the text that went back to the model. */
  end(result: { output: string; failed: boolean }): void;
}

/** The record of one run, from the question to the answer. */
export interface RootSpan {
  /** The id of the trace, or `undefined` when nothing is recorded. */
  readonly traceId: string | undefined;
  generation(start: GenerationStart): GenerationSpan;
  tool(call: { name: string; arguments: string }): ToolSpan;
  end(result: { answer?: string; error?: string }): void;
}

/**
 * Where a run leaves its trace. The loop talks to this and to nothing of
 * Langfuse. A fault inside it never reaches the caller; only `flush` may fail.
 */
export interface Tracer {
  root(question: string): RootSpan;
  /** Ends every observation still open as an error, because the run was cut short. */
  abort(reason: string): void;
  /** Sends everything recorded so far. Rejects with an `ApiError` when it cannot. */
  flush(): Promise<void>;
}

const NO_GENERATION: GenerationSpan = {
  traceparent: undefined,
  retried: () => {},
  firstToken: () => {},
  streamFailed: () => {},
  end: () => {},
};
const NO_TOOL: ToolSpan = { traceparent: undefined, end: () => {} };
export const NO_ROOT: RootSpan = {
  traceId: undefined,
  generation: () => NO_GENERATION,
  tool: () => NO_TOOL,
  end: () => {},
};

/** The tracer of a run that is not traced. */
export const NO_TRACER: Tracer = {
  root: () => NO_ROOT,
  abort: () => {},
  flush: async () => {},
};
