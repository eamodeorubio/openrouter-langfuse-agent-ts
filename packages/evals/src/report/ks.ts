/** The k of pass@k and pass^k the report prints unless `--k` says otherwise. */
export const DEFAULT_KS = [1, 3, 5];

/** The k list of `--k 1,3,5`, or `undefined` when it is not a list of whole numbers from 1. */
export const parseKs = (value: string | undefined): number[] | undefined => {
  if (value === undefined) return undefined;
  const ks = value.split(',').map(Number);
  return ks.every((k) => Number.isInteger(k) && k >= 1) ? ks : undefined;
};
