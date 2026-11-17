import { z } from 'zod';
import { callCatalog } from './catalog.js';
import type { CatalogModel } from './catalogCache.js';
import { allMatches, type CatalogFilters } from './catalogFetch.js';
import {
  isPaid,
  isPriceSort,
  PRICE_SORTS,
  type PriceSort,
  rankByPrice,
} from './priceSort.js';
import { perMillionTokens } from './prices.js';
import { isoDate } from './shape.js';
import { requestOptions, type Tool, type ToolContext } from './types.js';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
/** Input tokens for each output token when a blended sort comes without a mix. */
const DEFAULT_MIX = 3;

// The values of the API's `category` filter, as its reference lists it.
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

// The orders the API applies. Its `pricing-*` orders are left out on purpose:
// they sort by the average of both prices, so the first row is the cheapest
// by neither. The price sorts below replace them.
const API_SORTS = [
  'most-popular',
  'newest',
  'top-weekly',
  'context-high-to-low',
  'throughput-high-to-low',
  'latency-low-to-high',
  'intelligence-high-to-low',
  'coding-high-to-low',
  'agentic-high-to-low',
  'design-arena-elo-high-to-low',
] as const;

export const SORTS = [...API_SORTS, ...PRICE_SORTS] as const;

const quoted = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(', ');

const PRICE_SORT_LIST = quoted(PRICE_SORTS);
const BLENDED_SORTS = PRICE_SORTS.filter((sort) => sort.startsWith('blended'));

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

/** The error for a sort that is not offered. It points a model that asks for a removed `pricing-*` order to the ones that replace it. */
const unknownSort = (value: unknown): string => {
  const shown = String(value);
  const replacement = shown.startsWith('pricing-')
    ? ' For the lowest input price use "input-price-low-to-high", for the lowest output price "output-price-low-to-high", for a mix of both "blended-price-low-to-high"; "-high-to-low" reverses each.'
    : '';
  return `"${shown}" is not offered.${replacement} The values are: ${quoted(SORTS)}.`;
};

const SORT_DESCRIPTION = [
  'How to order the results.',
  'Orders the API applies: most-popular, top-weekly, newest (creation date), context-high-to-low, throughput-high-to-low, latency-low-to-high, intelligence-high-to-low, coding-high-to-low, agentic-high-to-low, design-arena-elo-high-to-low. Models without a score come last.',
  'Orders this tool applies over every match: input-price-low-to-high and input-price-high-to-low (by input price), output-price-low-to-high and output-price-high-to-low (by output price), blended-price-low-to-high and blended-price-high-to-low (input and output weighted by input_per_output). Prices are USD per million tokens. A free model has price 0 and comes first in a low-to-high order. A model with no price comes last. Equal prices come in id order.',
  'For the cheapest model by one price, sort by it and set limit to 1; add paid_only to skip free models.',
].join(' ');

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
      z.enum(SORTS, { error: (issue) => unknownSort(issue.input) }),
      SORT_DESCRIPTION,
    ),
    input_per_output: optional(
      z
        .number()
        .gt(
          0,
          'must be above 0, the input tokens for each output token, such as 3.',
        ),
      `Input tokens for each output token, above 0, default ${DEFAULT_MIX}. Only for ${BLENDED_SORTS.join(' and ')}; with any other sort the call fails. Use the ratio the user states.`,
    ),
    paid_only: optional(
      z.boolean(),
      'true drops free models (input and output price both 0) and models with no price. Needs a price sort: input-, output- or blended-price-*; without one the call fails. total counts the models that remain. false or absent keeps them all.',
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
      'Keep models whose input price is at least this many USD per million tokens, the input price, bound included. A free model has price 0, so a minimum of 0 keeps it. Applies before any sort.',
    ),
    max_prompt_price: optional(
      price,
      'Keep models whose input price is at most this many USD per million tokens, the input price, bound included. A free model has price 0, so it passes any maximum. Applies before any sort.',
    ),
    min_completion_price: optional(
      price,
      'Keep models whose output price is at least this many USD per million tokens, the output price, bound included. A free model has price 0, so a minimum of 0 keeps it. Applies before any sort.',
    ),
    max_completion_price: optional(
      price,
      'Keep models whose output price is at most this many USD per million tokens, the output price, bound included. A free model has price 0, so it passes any maximum. Applies before any sort.',
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
      'Models to skip. The default is 0. Use `next_offset` from the previous result to continue.',
    ),
  })
  .strict()
  .refine((args) => args.paid_only !== true || isPriceSort(args.sort), {
    path: ['paid_only'],
    message: `needs a price sort. Set sort to one of ${PRICE_SORT_LIST}.`,
  })
  .refine(
    (args) =>
      args.input_per_output === undefined ||
      (BLENDED_SORTS as readonly (string | undefined)[]).includes(args.sort),
    {
      path: ['input_per_output'],
      message: `applies to a blended sort only. Set sort to ${BLENDED_SORTS.map((sort) => `"${sort}"`).join(' or ')}, or leave input_per_output out.`,
    },
  );

type Args = z.infer<typeof parameters>;

const joined = (values: string[] | undefined): string | undefined =>
  values?.join(',');

/** The filters the API applies, under its own names. Lists become comma-separated text. */
const toFilters = (args: Args): CatalogFilters => ({
  q: args.query,
  category: args.category,
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

interface Page {
  models: CatalogModel[];
  total: number;
  hasNext: boolean;
}

/** One page of the catalog as the model reads it: compact entries, prices per million tokens, no descriptions. */
const shapePage = (offset: number, { models, total, hasNext }: Page) => ({
  total,
  offset,
  next_offset: nextOffset(offset, models.length, hasNext),
  models: models.map((model) => ({
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

/** One page of every match, ordered by price here, since the API has no order by one price. */
const priceSorted = async (
  args: Args,
  sort: PriceSort,
  context: ToolContext,
) => {
  const fetched = await allMatches(context, toFilters(args));
  if (!fetched.ok) {
    return fetched;
  }
  const priced = fetched.models.map((model) => ({
    id: model.id,
    input: perMillionTokens(model.pricing.prompt),
    output: perMillionTokens(model.pricing.completion),
    model,
  }));
  const ranked = rankByPrice(
    args.paid_only === true ? priced.filter(isPaid) : priced,
    sort,
    args.input_per_output ?? DEFAULT_MIX,
  );
  const models = ranked
    .slice(args.offset, args.offset + args.limit)
    .map((entry) => entry.model);
  return {
    ok: true as const,
    value: shapePage(args.offset, {
      models,
      total: ranked.length,
      hasNext: args.offset + models.length < ranked.length,
    }),
  };
};

export const searchModels: Tool<typeof parameters> = {
  name: 'search_models',
  description:
    'Search the OpenRouter catalog with filters and a sort order. Returns one page of compact entries: id, context length, prices in USD per million tokens, modalities, reasoning support and benchmark indices. Price sorts and paid_only are applied by this tool over every match, so the first row of a price sort is the cheapest by that price. Use get_model for the details of one entry.',
  parameters,
  run(args, context) {
    const { client } = context;
    const { sort } = args;
    if (isPriceSort(sort)) {
      return priceSorted(args, sort, context);
    }
    return callCatalog(
      () =>
        client.models.list(
          {
            ...toFilters(args),
            sort,
            offset: args.offset,
            limit: args.limit,
          },
          requestOptions(context),
        ),
      ({ result }) =>
        shapePage(args.offset, {
          models: result.data,
          total: result.totalCount,
          hasNext: result.links.next !== null,
        }),
    );
  },
};
