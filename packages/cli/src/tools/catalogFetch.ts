import type { OpenRouter } from '@openrouter/sdk';
import { callCatalog } from './catalog.js';
import { type CatalogModel, createCatalogCache } from './catalogCache.js';
import { requestOptions, type ToolContext, type ToolResult } from './types.js';

type ListQuery = NonNullable<Parameters<OpenRouter['models']['list']>[0]>;

/** The filters the API applies, under its own names, with no page and no order. */
export type CatalogFilters = Omit<ListQuery, 'offset' | 'limit' | 'sort'>;

/** Every match of some filters, or the reason there are none to give. */
export type Matches =
  | { ok: true; models: CatalogModel[] }
  | { ok: false; message: string };

/** The most models the API gives in one reply. */
const FETCH_LIMIT = 1000;
/** The most replies one read takes: ten times the catalog of today. */
const MAX_FETCH_PAGES = 5;

const TOO_MANY = `More than ${MAX_FETCH_PAGES * FETCH_LIMIT} models match, too many to sort by price. Narrow the filters (a context length, a modality, a supported parameter, a maximum price) and call again.`;

const CONTINUED =
  'The API did not give the whole list of this category, and its next page cannot be requested. Search again without category.';

/**
 * The whole list of a category, which comes in one reply: the API refuses a
 * page beside a category, so a list that offers a next page cannot be completed
 * and is refused whole.
 */
const wholeList = async (
  context: ToolContext,
  query: ListQuery,
): Promise<ToolResult<CatalogModel[]>> => {
  const read = await callCatalog(
    () => context.client.models.list(query, requestOptions(context)),
    ({ result }) => result,
  );
  if (!read.ok) {
    return read;
  }
  return read.value.links.next === null
    ? { ok: true, value: read.value.data }
    : { ok: false, message: CONTINUED };
};

/**
 * A search by category as the API takes it. The API refuses required
 * parameters beside a category, so the query goes without them and `narrow`
 * keeps the models of the reply that list them all.
 */
const forCategory = ({ supportedParameters, ...query }: ListQuery) => {
  const required = supportedParameters?.split(',') ?? [];
  return {
    query,
    narrow: (models: CatalogModel[]): CatalogModel[] =>
      models.filter((model) =>
        required.every((name) =>
          (model.supportedParameters as readonly string[]).includes(name),
        ),
      ),
  };
};

/** The models of a search by category, in the order the API gives them. */
export const categoryList = async (
  context: ToolContext,
  asked: ListQuery,
): Promise<ToolResult<CatalogModel[]>> => {
  const { query, narrow } = forCategory(asked);
  const read = await wholeList(context, query);
  return read.ok ? { ok: true, value: narrow(read.value) } : read;
};

/** Every match of the filters, read page by page. Null when they fill more than the most pages one read takes. */
const readPages = async (
  context: ToolContext,
  filters: CatalogFilters,
): Promise<CatalogModel[] | null> => {
  const models: CatalogModel[] = [];
  for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
    const { result } = await context.client.models.list(
      { ...filters, offset: models.length, limit: FETCH_LIMIT },
      requestOptions(context),
    );
    models.push(...result.data);
    if (result.links.next === null || result.data.length === 0) {
      return models;
    }
  }
  return null;
};

/** Every match of filters that have no category. */
const pagedList = async (
  context: ToolContext,
  filters: CatalogFilters,
): Promise<ToolResult<CatalogModel[]>> => {
  const read = await callCatalog(
    () => readPages(context, filters),
    (models) => models,
  );
  if (!read.ok) {
    return read;
  }
  return read.value === null
    ? { ok: false, message: TOO_MANY }
    : { ok: true, value: read.value };
};

/**
 * Every match of the filters. The run's cache keeps the list the API gave, so a
 * later call that sends the API the same filters makes no request. Calls that
 * start together share one read, which uses the deadline of the call that
 * started it.
 */
export const allMatches = async (
  context: ToolContext,
  filters: CatalogFilters,
): Promise<Matches> => {
  const cache = context.catalog ?? createCatalogCache();
  const { query, narrow } =
    filters.category === undefined
      ? { query: filters, narrow: (models: CatalogModel[]) => models }
      : forCategory(filters);
  const fetched = await cache.read(JSON.stringify(query), () =>
    query.category === undefined
      ? pagedList(context, query)
      : wholeList(context, query),
  );
  return fetched.ok ? { ok: true, models: narrow(fetched.value) } : fetched;
};
