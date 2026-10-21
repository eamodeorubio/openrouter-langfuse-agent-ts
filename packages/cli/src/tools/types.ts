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
}

/** A function the model may call. The schema validates what the model sends and is also what the model is shown. */
export interface Tool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Schema;
  run(args: z.infer<Schema>, context: ToolContext): Promise<ToolResult>;
}
