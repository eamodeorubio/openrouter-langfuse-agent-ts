import { isObject, parseJson } from '../json.js';
import type { ToolCall } from './run.js';

/** What the tool outputs of a run say about one model. A price is null when the API gave none. */
export interface ModelRecord {
  contextLength?: number;
  promptPrice?: number | null;
  completionPrice?: number | null;
}

type Json = Record<string, unknown>;

const price = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === 'number' ? value : undefined;

const sameSlug = (id: unknown, slug: string): boolean =>
  typeof id === 'string' && id.toLowerCase() === slug.toLowerCase();

/** A `get_model` result: `pricing.prompt` and `pricing.completion`. */
const fromGetModel = (result: Json): ModelRecord => {
  const pricing = isObject(result.pricing) ? result.pricing : {};
  return record(result.context_length, pricing.prompt, pricing.completion);
};

/** A `search_models` entry: `prompt_price` and `completion_price`. */
const fromSearchEntry = (entry: Json): ModelRecord =>
  record(entry.context_length, entry.prompt_price, entry.completion_price);

const record = (
  context: unknown,
  prompt: unknown,
  completion: unknown,
): ModelRecord => ({
  ...(typeof context === 'number' ? { contextLength: context } : {}),
  ...(price(prompt) !== undefined ? { promptPrice: price(prompt) } : {}),
  ...(price(completion) !== undefined
    ? { completionPrice: price(completion) }
    : {}),
});

/** The `models` of a `search_models` page, or none. */
const searchEntries = (result: Json): unknown[] =>
  // Stryker disable next-line ArrayDeclaration: equivalent because a string in the list is never an object with an id
  Array.isArray(result.models) ? result.models : [];

/** A model of a `search_models` page, with the prices of its entry. */
export interface ListedModel extends ModelRecord {
  id: string;
}

/** The models a `search_models` output lists, in its order, with ids in lower case. */
export const listedModels = (output: string): ListedModel[] => {
  const result = parseJson(output);
  if (!isObject(result)) return [];
  return searchEntries(result).flatMap((entry) =>
    isObject(entry) && typeof entry.id === 'string'
      ? [{ id: entry.id.toLowerCase(), ...fromSearchEntry(entry) }]
      : [],
  );
};

/** The ids of the models the successful calls returned: a `get_model` id and the ids of a `search_models` page. */
export const modelIds = (calls: readonly ToolCall[]): string[] =>
  calls.flatMap((call) => {
    const result = call.failed ? undefined : parseJson(call.output);
    if (!isObject(result)) return [];
    return [result, ...searchEntries(result)].flatMap((candidate) =>
      isObject(candidate) && typeof candidate.id === 'string'
        ? [candidate.id.toLowerCase()]
        : [],
    );
  });

/**
 * What the first successful call that holds the model says about it. The
 * tools are trusted: the figures a run must report are the ones they returned.
 */
export const modelRecord = (
  calls: readonly ToolCall[],
  slug: string,
): ModelRecord | undefined => {
  for (const call of calls) {
    if (call.failed) continue;
    const result = parseJson(call.output);
    if (!isObject(result)) continue;
    if (sameSlug(result.id, slug)) return fromGetModel(result);
    const entry = searchEntries(result).find(
      (candidate) => isObject(candidate) && sameSlug(candidate.id, slug),
    );
    if (isObject(entry)) return fromSearchEntry(entry);
  }
  return undefined;
};
