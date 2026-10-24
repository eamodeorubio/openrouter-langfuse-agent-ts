import type { ChatMessages } from '@openrouter/sdk/models';
import type { ToolCall } from '../assemble.js';

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
  /** One line. Present when the request failed. */
  error?: string | undefined;
}

export interface GenerationSpan {
  /** A failed attempt was repeated. */
  retried(): void;
  end(result: GenerationResult): void;
}

export interface ToolSpan {
  /** `output` is the text that went back to the model. */
  end(result: { output: string; failed: boolean }): void;
}

/** The record of one run, from the question to the answer. */
export interface RootSpan {
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

const NO_GENERATION: GenerationSpan = { retried: () => {}, end: () => {} };
const NO_TOOL: ToolSpan = { end: () => {} };
export const NO_ROOT: RootSpan = {
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
