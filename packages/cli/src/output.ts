import { z } from 'zod';

/** Capital letters joined by single underscores, such as `API_ERROR`. */
export const ERROR_CODE = /^[A-Z]+(_[A-Z]+)*$/;

const fields = {
  question: z.string().describe('The question the model received.'),
  answer: z
    .string()
    .describe('The answer, or the part of it written before a failure.'),
  thinking: z
    .string()
    .describe('The readable thinking of the model. Absent when there is none.'),
  traceId: z
    .string()
    .describe('The Langfuse trace id. Absent when the run is not traced.'),
};

const count = z.number().int().nonnegative();

const usage = z
  .strictObject({
    promptTokens: count.describe('Prompt tokens, summed over every request.'),
    completionTokens: count.describe(
      'Completion tokens, summed over every request.',
    ),
    totalTokens: count.describe('Total tokens, summed over every request.'),
    reasoningTokens: count
      .describe(
        'Tokens the model spent thinking. Present when at least one request reported them.',
      )
      .optional(),
    cachedTokens: count
      .describe(
        'Prompt tokens the provider served from its cache. Present when at least one request reported them.',
      )
      .optional(),
    cost: z
      .number()
      .nonnegative()
      .describe(
        'Cost in US dollars, summed over every request. Present only when every request reported one.',
      )
      .optional(),
  })
  .meta({
    title: 'Usage',
    description: 'What the question used, over every request it took.',
  });

const toolCall = z
  .strictObject({
    round: z
      .number()
      .int()
      .min(1)
      .describe(
        'The number of the model response that asked for the call, from 1. Calls made together share a round.',
      ),
    name: z.string().describe('The tool name the model sent.'),
    arguments: z
      .string()
      .describe(
        'The arguments exactly as the model sent them, valid JSON or not.',
      ),
    output: z
      .string()
      .describe(
        'The text the tool returned to the model, complete. For a call that never ran or never returned, the reason, such as [LIMIT_EXCEEDED] Tool calls limit exceeded.',
      ),
    failed: z
      .boolean()
      .describe(
        'True when the result was an error: an unknown tool, bad arguments, a failed request, a tool that threw, or a call that did not run or complete.',
      ),
  })
  .meta({
    id: 'ToolCall',
    title: 'ToolCall',
    description: 'One tool call the model made, and how it ended.',
  });

const toolCalls = z.array(toolCall).meta({
  id: 'ToolCalls',
  title: 'ToolCalls',
  description:
    'The tool calls of the run, ordered by round and then as the model listed them. Empty when there were none.',
});

const args = z
  .strictObject({
    verbose: z.boolean().describe('True when --verbose was given.'),
    thinking: z
      .boolean()
      .describe(
        'True with --thinking, false with --no-thinking. Absent when neither was given.',
      )
      .optional(),
    model: z
      .string()
      .describe('The value of --model. Absent when it was not given.')
      .optional(),
  })
  .meta({
    id: 'Args',
    title: 'Args',
    description: 'The arguments the CLI received, parsed.',
  });

const success = z
  .strictObject({
    question: fields.question,
    answer: fields.answer,
    success: z.literal(true),
    model: z.string().describe('The model that served the final response.'),
    usage,
    toolCalls,
    args,
    thinking: fields.thinking.optional(),
    traceId: fields.traceId.optional(),
  })
  .meta({
    title: 'Success',
    description: 'The run ended with an answer. Written to stdout.',
  });

const failure = z
  .strictObject({
    question: fields.question
      .describe(
        'The question. Absent when the failure came before it was known.',
      )
      .optional(),
    answer: fields.answer
      .describe(
        'The text written before the failure. Absent when there is none.',
      )
      .optional(),
    success: z.literal(false),
    toolCalls: toolCalls.optional(),
    args: args.optional(),
    thinking: fields.thinking.optional(),
    traceId: fields.traceId.optional(),
    error: z.strictObject({
      code: z
        .string()
        .regex(ERROR_CODE)
        .describe(
          'A short stable name for the kind of failure, such as API_ERROR.',
        ),
      message: z.string().describe('What went wrong, in words for the user.'),
    }),
  })
  .meta({
    title: 'Failure',
    description:
      'The run failed. Written to stderr. `toolCalls` is absent when the failure came before the first request to the model, and `args` when the arguments were rejected.',
  });

/** The one object `--json` writes. The published JSON Schema is generated from it. */
export const outputSchema = z
  .discriminatedUnion('success', [success, failure])
  .meta({
    title: 'openrouter-langfuse-agent-ts --json output',
    description:
      'The object the CLI writes under --json: a success on stdout, a failure on stderr.',
  });

export type JsonOutput = z.infer<typeof outputSchema>;

/** The object of a run that ended with an answer. */
export type SuccessOutput = Extract<JsonOutput, { success: true }>;

/** The object as one line of JSON ended by a newline. */
export const serialize = (output: JsonOutput): string =>
  `${JSON.stringify(output)}\n`;
