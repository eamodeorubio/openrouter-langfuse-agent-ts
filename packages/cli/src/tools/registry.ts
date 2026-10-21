import type { ChatFunctionTool } from '@openrouter/sdk/models';
import { z } from 'zod';
import { getModel } from './getModel.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

/** The tools the agent offers. */
export const TOOLS: readonly Tool[] = [getModel];

/** The tools as the chat API wants them: a name, a description and the JSON Schema of the arguments. */
export const functionTools = (tools: readonly Tool[]): ChatFunctionTool[] =>
  tools.map((tool) => {
    const { $schema: _omitted, ...schema } = z.toJSONSchema(tool.parameters);
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: schema,
      },
    };
  });

const failure = (message: string): ToolResult => ({ ok: false, message });

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');

const attempt = async (
  tools: readonly Tool[],
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolResult> => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return failure(
      `Unknown tool "${name}". The tools are: ${tools.map((t) => t.name).join(', ')}.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(rawArguments || '{}');
  } catch (error) {
    return failure(
      `The arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = tool.parameters.safeParse(json);
  if (!parsed.success) {
    return failure(`Invalid arguments. ${describeIssues(parsed.error)}`);
  }
  return tool.run(parsed.data, context);
};

/**
 * Runs one tool call the model made and returns the text that goes back to it:
 * the tool's value as JSON, or `{"error": "<one line>"}`. A call that fails is
 * a result for the model to read, not a failure of the run.
 */
export const runTool = async (
  tools: readonly Tool[],
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<string> => {
  const result = await attempt(tools, name, rawArguments, context);
  return JSON.stringify(result.ok ? result.value : { error: result.message });
};
