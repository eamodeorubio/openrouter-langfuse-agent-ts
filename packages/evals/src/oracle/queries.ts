import { finite } from '../json.js';
import type { CatalogModel } from './snapshot.js';

export class QueryError extends Error {}

/** A query turns a snapshot and the parameters of a case into the slugs that are acceptable answers. */
type Query = (
  models: readonly CatalogModel[],
  params: Record<string, unknown>,
) => string[];

/** Models within this share of the cheapest blended price tie with it. */
const TIE = 0.01;
const DEFAULT_MIX = 3;

/**
 * The price of a model for a given mix of input tokens per output token, in
 * USD per million tokens. Null when the snapshot has no price for it.
 */
export const blendedPrice = (
  model: CatalogModel,
  mix: number,
): number | null =>
  model.inputPrice === null || model.outputPrice === null
    ? null
    : (mix * model.inputPrice + model.outputPrice) / (mix + 1);

const number = (
  query: string,
  name: string,
  value: unknown,
  fallback: number,
  valid: (n: number) => boolean,
  rule: string,
): number => {
  if (value === undefined) return fallback;
  if (!finite(value) || !valid(value)) {
    throw new QueryError(
      `The query ${query} takes ${name} as ${rule}, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
};

const strings = (query: string, name: string, value: unknown): string[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new QueryError(
      `The query ${query} takes ${name} as a list of text, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
};

/** The paid models that meet every constraint and whose blended price is within one percent of the lowest. */
const cheapestBlended: Query = (models, params) => {
  const name = 'cheapest-blended';
  const minContext = number(
    name,
    'minContext',
    params.minContext,
    0,
    (n) => n >= 0,
    'a number from 0',
  );
  const required = strings(
    name,
    'supportedParameters',
    params.supportedParameters,
  );
  const mix = number(
    name,
    'mix',
    params.mix,
    DEFAULT_MIX,
    (n) => n > 0,
    'a number above 0',
  );

  const priced = models.flatMap((model) => {
    // A model with no price is as good as a free one: not paid.
    const blended = blendedPrice(model, mix) ?? 0;
    const eligible =
      blended > 0 &&
      (model.contextLength ?? 0) >= minContext &&
      required.every((parameter) =>
        model.supportedParameters.includes(parameter),
      );
    return eligible ? [{ id: model.id, blended }] : [];
  });
  const cheapest = Math.min(...priced.map((entry) => entry.blended));
  return priced
    .filter((entry) => entry.blended <= cheapest * (1 + TIE))
    .map((entry) => entry.id)
    .sort();
};

const QUERIES = new Map<string, Query>([['cheapest-blended', cheapestBlended]]);

export const QUERY_NAMES: string[] = [...QUERIES.keys()];

/** Runs the query a case names. An unknown name is an error that lists the known ones. */
export const runQuery = (
  name: string,
  models: readonly CatalogModel[],
  params: Record<string, unknown> = {},
): string[] => {
  const query = QUERIES.get(name);
  if (!query) {
    // Stryker disable next-line StringLiteral: equivalent while only one query exists, as a list of one has no separator
    const known = QUERY_NAMES.join(', ');
    throw new QueryError(
      `Unknown oracle query "${name}". The known queries are: ${known}.`,
    );
  }
  return query(models, params);
};
