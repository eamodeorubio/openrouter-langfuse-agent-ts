import type { OpenRouter } from '@openrouter/sdk';
import type { z } from 'zod';

/** What a tool hands back to the model: a value, or a one-line reason it failed. */
export type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

export interface ToolContext {
  client: OpenRouter;
  /** The most one call may take, in total. */
  timeoutMs: number;
  /** The trace context of this call, to send with its requests, when the run is traced. */
  traceparent?: string | undefined;
}

/** The per-request options every SDK method takes: deadline, headers, signal. */
type SdkRequestOptions = NonNullable<
  Parameters<OpenRouter['models']['list']>[1]
>;

/** The options a tool gives the SDK with each request: the deadline, and the trace context when there is one. */
export const requestOptions = ({
  timeoutMs,
  traceparent,
}: ToolContext): SdkRequestOptions => ({
  timeoutMs,
  ...(traceparent ? { headers: { traceparent } } : {}),
});

/** A function the model may call. The schema validates what the model sends and is also what the model is shown. */
export interface Tool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Schema;
  run(args: z.infer<Schema>, context: ToolContext): Promise<ToolResult>;
}
