/** The orders `search_models` applies itself, because the API has no order by one price. */
export const PRICE_SORTS = [
  'input-price-low-to-high',
  'input-price-high-to-low',
  'output-price-low-to-high',
  'output-price-high-to-low',
  'blended-price-low-to-high',
  'blended-price-high-to-low',
] as const;

/** Input tokens for each output token when a blended sort comes without a mix. */
export const DEFAULT_MIX = 3;

export type PriceSort = (typeof PRICE_SORTS)[number];

export const isPriceSort = (sort: string | undefined): sort is PriceSort =>
  (PRICE_SORTS as readonly (string | undefined)[]).includes(sort);

/** What an order needs of a model: its slug and its prices in USD per million tokens, null when the API gives none. */
export interface Priced {
  id: string;
  input: number | null;
  output: number | null;
}

/**
 * The price of a model for a mix of `mix` input tokens to one output token.
 * Null when either price is missing.
 */
export const blendedPrice = (
  { input, output }: Priced,
  mix: number,
): number | null =>
  input === null || output === null ? null : (mix * input + output) / (mix + 1);

/** A model is paid when both prices are known and at least one is above 0. */
export const isPaid = ({ input, output }: Priced): boolean =>
  input !== null && output !== null && (input > 0 || output > 0);

const priceOf = (
  entry: Priced,
  sort: PriceSort,
  mix: number,
): number | null => {
  if (sort.startsWith('input')) {
    return entry.input;
  }
  if (sort.startsWith('output')) {
    return entry.output;
  }
  return blendedPrice(entry, mix);
};

/**
 * The models in the order of `sort`. A model with no price in that sort comes
 * last in both directions, and equal prices come in ascending order of id, so
 * the order is the same on every call. The input list is not changed.
 */
export const rankByPrice = <T extends Priced>(
  entries: readonly T[],
  sort: PriceSort,
  mix: number,
): T[] => {
  const direction = sort.endsWith('low-to-high') ? 1 : -1;
  const keyed = entries.map((entry) => ({
    entry,
    price: priceOf(entry, sort, mix),
  }));
  keyed.sort((a, b) => {
    if (a.price === null || b.price === null) {
      return a.price === b.price
        ? byId(a.entry, b.entry)
        : a.price === null
          ? 1
          : -1;
    }
    return direction * (a.price - b.price) || byId(a.entry, b.entry);
  });
  return keyed.map(({ entry }) => entry);
};

/** Slugs are unique in the catalog, so two models never share an id. */
// Stryker disable next-line EqualityOperator: equivalent because ids are unique, so `<` and `<=` differ only for a model compared with itself.
const byId = (a: Priced, b: Priced): number => (a.id < b.id ? -1 : 1);
