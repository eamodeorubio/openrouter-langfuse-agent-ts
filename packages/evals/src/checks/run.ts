import { isObject } from '../json.js';

/** One tool call of a run, as the CLI's `--json` object lists it. */
export interface ToolCall {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

/** The parts of the CLI's success object the checks read. */
export interface Success {
  question: string;
  answer: string;
  toolCalls: ToolCall[];
}

const isToolCall = (value: unknown): value is ToolCall =>
  isObject(value) &&
  typeof value.name === 'string' &&
  typeof value.arguments === 'string' &&
  typeof value.output === 'string' &&
  typeof value.failed === 'boolean';

/** The output of a run as a success object, or `undefined` when it is anything else. */
export const asSuccess = (output: unknown): Success | undefined => {
  if (!isObject(output) || output.success !== true) return undefined;
  if (typeof output.answer !== 'string') return undefined;
  return {
    question: typeof output.question === 'string' ? output.question : '',
    answer: output.answer,
    toolCalls: Array.isArray(output.toolCalls)
      ? output.toolCalls.filter(isToolCall)
      : [],
  };
};

/** The calls that returned a result and not an error. */
export const successfulCalls = (run: Success): ToolCall[] =>
  run.toolCalls.filter((call) => !call.failed);

export const lookupMade = (run: Success): boolean =>
  successfulCalls(run).length > 0;

export const isBlank = (run: Success): boolean => run.answer.trim() === '';
