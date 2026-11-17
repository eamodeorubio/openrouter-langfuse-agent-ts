import type { OpenRouter } from '@openrouter/sdk';
import { callCatalog } from './catalog.js';
import { type CatalogModel, createCatalogCache } from './catalogCache.js';
import { requestOptions, type ToolContext } from './types.js';

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

/**
 * Every match of the filters. The run's cache keeps the list, so a later call
 * with the same filters makes no request. Calls that start together share one
 * read, which uses the deadline of the call that started it.
 */
export const allMatches = async (
  context: ToolContext,
  filters: CatalogFilters,
): Promise<Matches> => {
  const cache = context.catalog ?? createCatalogCache();
  const fetched = await cache.read(JSON.stringify(filters), async () => {
    const read = await callCatalog(
      () => readPages(context, filters),
      (models) => models,
    );
    return read.ok && read.value === null
      ? { ok: false, message: TOO_MANY }
      : read;
  });
  // `callCatalog` hands the value back as unknown; `readPages` made it.
  return fetched.ok
    ? { ok: true, models: fetched.value as CatalogModel[] }
    : fetched;
};
