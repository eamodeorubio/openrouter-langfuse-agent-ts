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

const success = z
  .strictObject({
    question: fields.question,
    answer: fields.answer,
    success: z.literal(true),
    model: z.string().describe('The model that served the final response.'),
    usage,
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
    description: 'The run failed. Written to stderr.',
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
