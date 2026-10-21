import type { OpenRouter } from '@openrouter/sdk';
import type { ModelsListResponse } from '@openrouter/sdk/models';
import { z } from 'zod';
import { callCatalog } from './catalog.js';
import { perMillionTokens } from './prices.js';
import { isoDate } from './shape.js';
import type { Tool } from './types.js';

type ListQuery = NonNullable<Parameters<OpenRouter['models']['list']>[0]>;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

// The values of the API's `category` and `sort` filters, as its reference lists them.
const CATEGORIES = [
  'programming',
  'roleplay',
  'marketing',
  'marketing/seo',
  'technology',
  'science',
  'translation',
  'legal',
  'finance',
  'health',
  'trivia',
  'academia',
] as const;

const SORTS = [
  'most-popular',
  'newest',
  'top-weekly',
  'pricing-low-to-high',
  'pricing-high-to-low',
  'context-high-to-low',
  'throughput-high-to-low',
  'latency-low-to-high',
  'intelligence-high-to-low',
  'coding-high-to-low',
  'agentic-high-to-low',
  'design-arena-elo-high-to-low',
] as const;

const words = z.array(z.string().min(1)).min(1);
const price = z.number().min(0);
const score = z.number().min(0);

/**
 * An argument the model may leave out. Some providers make a model fill every
 * optional argument with null, and reject a call whose null does not fit the
 * schema, so null is allowed and read as absent.
 */
const optional = <T extends z.ZodType>(schema: T, description: string) =>
  schema
    .nullish()
    .transform((value) => value ?? undefined)
    .describe(description);

/** Like `optional`, with the value used when the argument is absent. */
const optionalWith = <T extends z.ZodType>(
  schema: T,
  fallback: z.infer<T>,
  description: string,
) =>
  schema
    .nullish()
    .transform((value): z.infer<T> => value ?? fallback)
    .describe(description);

const parameters = z
  .object({
    query: optional(
      z.string().min(1),
      'Free text matched against model names and slugs.',
    ),
    category: optional(
      z.enum(CATEGORIES),
      'The use case the models are used for.',
    ),
    sort: optional(
      z.enum(SORTS),
      'Server-side order. Prefer it to sorting yourself: models without the chosen score come last.',
    ),
    input_modalities: optional(
      words,
      'Input kinds the model must accept, such as `image`, `audio`, `file`, `text`.',
    ),
    output_modalities: optional(
      words,
      'Output kinds the model must produce. Only `text` models are listed unless you ask for others.',
    ),
    supported_parameters: optional(
      words,
      'Request parameters the model must support, such as `tools`, `reasoning`, `response_format`.',
    ),
    min_context_length: optional(
      z.number().int().min(1),
      'Smallest context window, in tokens.',
    ),
    min_prompt_price: optional(
      price,
      'Lowest input price, in USD per million tokens.',
    ),
    max_prompt_price: optional(
      price,
      'Highest input price, in USD per million tokens.',
    ),
    min_completion_price: optional(
      price,
      'Lowest output price, in USD per million tokens.',
    ),
    max_completion_price: optional(
      price,
      'Highest output price, in USD per million tokens.',
    ),
    architecture: optional(
      z.string().min(1),
      'Model family, such as `GPT`, `Claude`, `Gemini`, `Llama`.',
    ),
    authors: optional(words, 'Author slugs, such as `openai` or `anthropic`.'),
    providers: optional(words, 'Names of hosting providers.'),
    min_intelligence_index: optional(
      score,
      'Lowest Artificial Analysis intelligence index.',
    ),
    min_coding_index: optional(
      score,
      'Lowest Artificial Analysis coding index.',
    ),
    min_agentic_index: optional(
      score,
      'Lowest Artificial Analysis agentic index.',
    ),
    min_tool_success_rate: optional(
      z.number().min(0).max(1),
      'Lowest tool-calling success rate, from 0 to 1.',
    ),
    max_age_days: optional(
      z.number().int().min(0),
      'Only models released within this many days.',
    ),
    zero_data_retention: optional(
      z.boolean(),
      'When true, only models with zero-data-retention endpoints.',
    ),
    limit: optionalWith(
      z.number().int().min(1).max(MAX_LIMIT),
      DEFAULT_LIMIT,
      `Models per page, 1 to ${MAX_LIMIT}. The default is ${DEFAULT_LIMIT}.`,
    ),
    offset: optionalWith(
      z.number().int().min(0),
      0,
      'Models to skip. The default is 0. Use `next_offset` from the previous page to continue.',
    ),
  })
  .strict();

type Args = z.infer<typeof parameters>;

const joined = (values: string[] | undefined): string | undefined =>
  values?.join(',');

/** The arguments under the API's own names. Lists become comma-separated text. */
const toListQuery = (args: Args): ListQuery => ({
  offset: args.offset,
  limit: args.limit,
  q: args.query,
  category: args.category,
  sort: args.sort,
  inputModalities: joined(args.input_modalities),
  outputModalities: joined(args.output_modalities),
  supportedParameters: joined(args.supported_parameters),
  context: args.min_context_length,
  minPrice: args.min_prompt_price,
  maxPrice: args.max_prompt_price,
  minOutputPrice: args.min_completion_price,
  maxOutputPrice: args.max_completion_price,
  arch: args.architecture,
  modelAuthors: joined(args.authors),
  providers: joined(args.providers),
  minIntelligenceIndex: args.min_intelligence_index,
  minCodingIndex: args.min_coding_index,
  minAgenticIndex: args.min_agentic_index,
  minToolSuccessRate: args.min_tool_success_rate,
  maxAgeDays: args.max_age_days,
  // The API knows only `true`; false means no filter.
  zdr: args.zero_data_retention ? 'true' : undefined,
});

/**
 * Where the next page starts, or null on the last page. It always moves past
 * `offset`. Exported so a property test can state that invariant directly.
 */
export const nextOffset = (
  offset: number,
  count: number,
  hasNext: boolean,
): number | null => (hasNext && count > 0 ? offset + count : null);

/** One page of the catalog as the model reads it: compact entries, prices per million tokens, no descriptions. */
const shapePage = (offset: number, page: ModelsListResponse) => ({
  total: page.totalCount,
  offset,
  next_offset: nextOffset(offset, page.data.length, page.links.next !== null),
  models: page.data.map((model) => ({
    id: model.id,
    name: model.name,
    context_length: model.contextLength,
    max_completion_tokens: model.topProvider.maxCompletionTokens ?? null,
    prompt_price: perMillionTokens(model.pricing.prompt),
    completion_price: perMillionTokens(model.pricing.completion),
    input_modalities: model.architecture.inputModalities,
    output_modalities: model.architecture.outputModalities,
    supports_reasoning: model.reasoning !== undefined,
    intelligence_index:
      model.benchmarks?.artificialAnalysis?.intelligenceIndex ?? null,
    coding_index: model.benchmarks?.artificialAnalysis?.codingIndex ?? null,
    agentic_index: model.benchmarks?.artificialAnalysis?.agenticIndex ?? null,
    created: isoDate(model.created),
  })),
});

export const searchModels: Tool<typeof parameters> = {
  name: 'search_models',
  description:
    'Search the OpenRouter catalog with filters and a sort order. Returns one page of compact entries: id, context length, prices in USD per million tokens, modalities, reasoning support and benchmark indices. Use get_model for the details of one entry.',
  parameters,
  run(args, { client, timeoutMs }) {
    return callCatalog(
      () => client.models.list(toListQuery(args), { timeoutMs }),
      ({ result }) => shapePage(args.offset, result),
    );
  },
};
