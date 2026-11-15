import { asSuccess, type Success, type ToolCall } from '../checks/run.js';
import { isObject } from '../json.js';

/** The size of a text in bytes, as UTF-8: what the limit of the grader counts. */
export const stateBytes = (text: string): number => Buffer.byteLength(text);

/** One tool call as a line: its place, its name, whether it failed, and what it was asked. */
const callLine = (call: ToolCall, index: number): string =>
  `${index + 1}. ${call.name} (round ${call.round}${call.failed ? ', failed' : ''}) ${call.arguments}`;

const calls = (run: Success, outputs: boolean): string => {
  if (run.toolCalls.length === 0) return 'Tool calls: none.';
  return [
    'Tool calls:',
    ...run.toolCalls.flatMap((call, index) => [
      callLine(call, index),
      ...(outputs ? [`   Output: ${call.output}`] : []),
    ]),
  ].join('\n');
};

/** The question the CLI reports, as the case resolved it, or the one the case holds. */
const question = (run: Success, context: unknown): string => {
  if (run.question !== '') return run.question;
  const held =
    isObject(context) && isObject(context.vars)
      ? context.vars.question
      : undefined;
  return typeof held === 'string' && held !== '' ? held : '(not reported)';
};

/** Builds a state from the parts a rubric needs. A run that is no success object is handed over as it is. */
const build =
  (parts: (run: Success, context: unknown) => string[]) =>
  (output: unknown, context: unknown): string => {
    const run = asSuccess(output);
    if (!run) return JSON.stringify(output) ?? String(output);
    return parts(run, context).join('\n\n');
  };

/** judge-grounding: what the tools returned, and the answer. */
export const grounding = build((run) => [
  calls(run, true),
  `Answer: ${run.answer}`,
]);

/** judge-relevance: the question, what was asked of the tools, and the answer. */
export const relevance = build((run, context) => [
  `Question: ${question(run, context)}`,
  calls(run, false),
  `Answer: ${run.answer}`,
]);

/** judge-usefulness: the same state as relevance, for another question. */
export const usefulness = relevance;

/** judge-tool-usage: the question and what was asked of the tools. */
export const toolUsage = build((run, context) => [
  `Question: ${question(run, context)}`,
  calls(run, false),
]);

/** The builder of the state of each rubric, by metric. */
export const STATE_BUILDERS: Record<
  string,
  (output: unknown, context: unknown) => string
> = {
  'judge-grounding': grounding,
  'judge-relevance': relevance,
  'judge-usefulness': usefulness,
  'judge-tool-usage': toolUsage,
};
