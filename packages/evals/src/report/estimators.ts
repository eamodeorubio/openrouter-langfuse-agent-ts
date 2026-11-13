const isCount = (value: number, min: number): boolean =>
  Number.isInteger(value) && value >= min;

/** Checks n runs, c passes and k draws, and says which one is wrong. */
const check = (n: number, c: number, k: number): void => {
  if (!isCount(n, 1)) {
    throw new RangeError(`n must be a whole number of at least 1, got ${n}.`);
  }
  if (!isCount(c, 0) || c > n) {
    throw new RangeError(
      `c must be a whole number from 0 to n=${n}, got ${c}.`,
    );
  }
  if (!isCount(k, 1) || k > n) {
    throw new RangeError(
      `k must be a whole number from 1 to n=${n}, got k=${k}.`,
    );
  }
};

/** The probability that k draws without replacement from n runs all hit one of the `good` runs. */
const allDrawsIn = (n: number, good: number, k: number): number => {
  let probability = 1;
  for (let i = 0; i < k; i++) {
    probability *= Math.max(good - i, 0) / (n - i);
  }
  return probability;
};

/** pass@k = 1 - C(n-c, k) / C(n, k): at least one of k runs passes. */
export const passAtK = (n: number, c: number, k: number): number => {
  check(n, c, k);
  return 1 - allDrawsIn(n, n - c, k);
};

/** pass^k = C(c, k) / C(n, k): all k runs pass. */
export const passHatK = (n: number, c: number, k: number): number => {
  check(n, c, k);
  return allDrawsIn(n, c, k);
};
