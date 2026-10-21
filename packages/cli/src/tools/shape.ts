import { perMillionTokens } from './prices.js';

const snake = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** The same data with every object key in snake_case, as the model sees the API's own names. */
export const snakeKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(snakeKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        snake(key),
        snakeKeys(inner),
      ]),
    );
  }
  return value;
};

/** The prices that are per token. The others (request, image, audio, web search) are not dollars per million tokens. */
const TOKEN_PRICES = [
  'prompt',
  'completion',
  'inputCacheRead',
  'inputCacheWrite',
  'inputCacheWrite1h',
  'internalReasoning',
] as const;

type Prices = Partial<Record<string, unknown>>;

const tokenPrices = (prices: Prices): Record<string, number | null> =>
  Object.fromEntries(
    TOKEN_PRICES.filter((key) => prices[key] !== undefined).map((key) => [
      snake(key),
      perMillionTokens(prices[key]),
    ]),
  );

/** What an override may keep besides its token prices: the conditions under which it applies. */
const OVERRIDE_CONDITIONS = [
  'minPromptTokens',
  'utcDays',
  'utcStart',
  'utcEnd',
] as const;

const pick = (source: Prices, keys: readonly string[]): Prices =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => keys.includes(key)),
  );

interface Pricing extends Prices {
  overrides?: Prices[] | undefined;
}

/** The token prices of a model in dollars per million tokens, and its conditional overrides. */
export const shapePricing = ({ overrides, ...prices }: Pricing) => ({
  ...tokenPrices(prices),
  ...(overrides && {
    overrides: overrides.map((override) => ({
      ...(snakeKeys(pick(override, OVERRIDE_CONDITIONS)) as object),
      ...tokenPrices(override),
    })),
  }),
});

/** A Unix timestamp as `YYYY-MM-DD`. */
export const isoDate = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10);
