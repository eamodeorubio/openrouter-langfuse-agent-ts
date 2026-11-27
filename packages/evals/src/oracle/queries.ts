import { finite } from '../json.js';
import type { CatalogModel } from './snapshot.js';
import { parseWorkload, workloadCost } from './workload.js';

export class QueryError extends Error {}

/** A query turns a snapshot and the parameters of a case into the slugs that are acceptable answers. */
type Query = (
  models: readonly CatalogModel[],
  params: Record<string, unknown>,
) => string[];

/** Models within this share of the best price or score tie with it. */
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

/** Refuses a parameter a query does not know, so that a typo cannot turn a constraint into nothing. */
const known = (
  query: string,
  params: Record<string, unknown>,
  names: string[],
): void => {
  for (const name of Object.keys(params)) {
    if (!names.includes(name)) {
      throw new QueryError(
        `Unknown parameter "${name}" for the query ${query}. The known ones are: ${names.join(', ')}.`,
      );
    }
  }
};

const FROM_ZERO = (n: number): boolean => n >= 0;

/** The constraints most queries share: a context, parameters and modalities. */
interface Constraints {
  minContext: number;
  parameters: string[];
  inputModalities: string[];
  outputModalities: string[];
}

const SHARED = [
  'minContext',
  'supportedParameters',
  'inputModalities',
  'outputModalities',
];

const constraintsOf = (
  query: string,
  params: Record<string, unknown>,
): Constraints => ({
  minContext: number(
    query,
    'minContext',
    params.minContext,
    0,
    FROM_ZERO,
    'a number from 0',
  ),
  parameters: strings(query, 'supportedParameters', params.supportedParameters),
  inputModalities: strings(query, 'inputModalities', params.inputModalities),
  outputModalities: strings(query, 'outputModalities', params.outputModalities),
});

const meets = (model: CatalogModel, c: Constraints): boolean =>
  (model.contextLength ?? 0) >= c.minContext &&
  c.parameters.every((name) => model.supportedParameters.includes(name)) &&
  c.inputModalities.every((name) => model.inputModalities.includes(name)) &&
  c.outputModalities.every((name) => model.outputModalities.includes(name));

/** The ids of the models within one percent of the lowest of `price`, in ascending order. */
const lowest = (priced: { id: string; price: number }[]): string[] => {
  const cheapest = Math.min(...priced.map((entry) => entry.price));
  return priced
    .filter((entry) => entry.price <= cheapest * (1 + TIE))
    .map((entry) => entry.id)
    .sort();
};

/** The paid models that meet every constraint and whose blended price is within one percent of the lowest. */
const cheapestBlended: Query = (models, params) => {
  const name = 'cheapest-blended';
  known(name, params, ['minContext', 'supportedParameters', 'mix']);
  const { minContext, parameters } = constraintsOf(name, params);
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
    return blended > 0 &&
      meets(model, {
        minContext,
        parameters,
        inputModalities: [],
        outputModalities: [],
      })
      ? [{ id: model.id, price: blended }]
      : [];
  });
  return lowest(priced);
};

/** The models with an input price above 0 that meet every constraint, within one percent of the lowest input price. */
const cheapestInput: Query = (models, params) => {
  const name = 'cheapest-input';
  known(name, params, SHARED);
  const constraints = constraintsOf(name, params);
  const priced = models.flatMap((model) => {
    const price = model.inputPrice ?? 0;
    return price > 0 && meets(model, constraints)
      ? [{ id: model.id, price }]
      : [];
  });
  return lowest(priced);
};

/** Every model that meets every constraint, and has an input price below `maxInputPrice` when one is given. */
const matching: Query = (models, params) => {
  const name = 'matching';
  known(name, params, [...SHARED, 'maxInputPrice']);
  const constraints = constraintsOf(name, params);
  const max =
    params.maxInputPrice === undefined
      ? undefined
      : number(
          name,
          'maxInputPrice',
          params.maxInputPrice,
          0,
          FROM_ZERO,
          'a number from 0',
        );
  return models
    .filter(
      (model) =>
        meets(model, constraints) &&
        (max === undefined ||
          (model.inputPrice !== null && model.inputPrice < max)),
    )
    .map((model) => model.id)
    .sort();
};

/** The models with the highest score of one benchmark index, and those within one percent of it. */
const topIndex: Query = (models, params) => {
  const name = 'top-index';
  known(name, params, ['index']);
  const { index } = params;
  if (typeof index !== 'string' || index === '') {
    throw new QueryError(
      `The query ${name} takes index as the name of a score, such as legal_index, got ${JSON.stringify(index)}.`,
    );
  }
  const scored = models.flatMap(({ id, scores = {} }) => {
    // An own key only: the name comes from a case, and every object has a `toString`.
    const score = Object.hasOwn(scores, index) ? scores[index] : undefined;
    return score === undefined ? [] : [{ id, score }];
  });
  const best = Math.max(...scored.map((entry) => entry.score));
  return scored
    .filter((entry) => entry.score >= best - Math.abs(best) * TIE)
    .map((entry) => entry.id)
    .sort();
};

/** Every model with known prices and the parameters whose cost for a workload in a month is at most the budget. */
const withinBudget: Query = (models, params) => {
  const name = 'within-budget';
  known(name, params, ['workload', 'budget', 'supportedParameters']);
  const workload = parseWorkload(params.workload);
  if (!workload) {
    throw new QueryError(
      `The query ${name} takes workload as an object of chatsPerDay, inputTokens, outputTokens and days, each a number from 0, got ${JSON.stringify(params.workload)}.`,
    );
  }
  if (params.budget === undefined) {
    throw new QueryError(
      `The query ${name} takes budget as a number from 0, got undefined.`,
    );
  }
  const budget = number(
    name,
    'budget',
    params.budget,
    0,
    FROM_ZERO,
    'a number from 0',
  );
  const required = strings(
    name,
    'supportedParameters',
    params.supportedParameters,
  );
  return models
    .filter(
      (model) =>
        model.inputPrice !== null &&
        model.outputPrice !== null &&
        required.every((parameter) =>
          model.supportedParameters.includes(parameter),
        ) &&
        workloadCost(workload, model.inputPrice, model.outputPrice) <= budget,
    )
    .map((model) => model.id)
    .sort();
};

const QUERIES = new Map<string, Query>([
  ['cheapest-blended', cheapestBlended],
  ['cheapest-input', cheapestInput],
  ['matching', matching],
  ['within-budget', withinBudget],
  ['top-index', topIndex],
]);

export const QUERY_NAMES: string[] = [...QUERIES.keys()];

/** Runs the query a case names. An unknown name is an error that lists the known ones. */
export const runQuery = (
  name: string,
  models: readonly CatalogModel[],
  params: Record<string, unknown> = {},
): string[] => {
  const query = QUERIES.get(name);
  if (!query) {
    const known = QUERY_NAMES.join(', ');
    throw new QueryError(
      `Unknown oracle query "${name}". The known queries are: ${known}.`,
    );
  }
  return query(models, params);
};
