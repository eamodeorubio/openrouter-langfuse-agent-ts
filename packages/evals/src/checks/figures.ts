interface Figure {
  value: number;
  /** Digits after the decimal point, as written. */
  decimals: number;
  /** The suffix: `k` or `m` for thousands and millions, `money` for `USD` or `dollars`. */
  unit?: 'k' | 'm' | 'money';
  /** Written with a leading `$`. */
  dollar: boolean;
}

// An optional `$`, a number with thousands separators or not, and an optional
// unit. The number may not start or end inside a word, so `gpt-oss-20b` holds none.
const FIGURE =
  /(?<![\w.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:([km])|\s(usd|dollars?))?(?![\w])/gi;

// A count grouped in threes by a space, a no-break space, a narrow no-break
// space or a thin space: `131 072`.
const SPACE_GROUPS =
  /(?<![\d.,])(\d{1,3})((?:[ \u00a0\u202f\u2009]\d{3})+)(?!\d)/g;

/** The same text with each space-grouped number written whole. */
const joinGroups = (text: string): string =>
  text.replace(
    SPACE_GROUPS,
    (_, head: string, rest: string) => `${head}${rest.replace(/\D/g, '')}`,
  );

/**
 * The figures of a text. A number grouped by spaces counts twice: whole, and
 * as the separate numbers it could also be, as in `100 200 300`.
 */
const figuresIn = (text: string): Figure[] => [
  ...scan(text),
  ...scan(joinGroups(text)),
];

const scan = (text: string): Figure[] =>
  [...text.matchAll(FIGURE)].map((match) => {
    const dollar = match[1];
    const whole = match[2] as string;
    const fraction = match[3];
    const scale = match[4];
    const money = match[5];
    const unit = scale
      ? (scale.toLowerCase() as 'k' | 'm')
      : money
        ? ('money' as const)
        : undefined;
    return {
      value: Number(
        `${whole.replace(/,/g, '')}${fraction ? `.${fraction}` : ''}`,
      ),
      decimals: fraction?.length ?? 0,
      dollar: dollar !== undefined,
      ...(unit ? { unit } : {}),
    };
  });

const close = (a: number, b: number): boolean =>
  // Stryker disable next-line EqualityOperator: equivalent because no figure sits exactly on a bound of 1e-9
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const roundTo = (value: number, decimals: number): number =>
  Number(value.toFixed(decimals));

/** A price: the number as written, with or without a currency mark or trailing zeros. */
export const matchesPrice = (answer: string, expected: number): boolean =>
  figuresIn(answer).some(
    (figure) =>
      (figure.unit === undefined || figure.unit === 'money') &&
      close(figure.value, expected),
  );

const SCALES = { k: [1000, 1024], m: [1_000_000, 1_048_576] } as const;

/** A token count: the digits, or a `k` or `m` form at the stated precision, decimal or binary. */
export const matchesCount = (answer: string, expected: number): boolean =>
  figuresIn(answer).some((figure) => {
    if (figure.unit === 'money') return false;
    if (figure.unit === undefined) return close(figure.value, expected);
    if (figure.value === 0) return false;
    return SCALES[figure.unit].some((scale) =>
      close(roundTo(expected / scale, figure.decimals), figure.value),
    );
  });

/** A cost: a money amount, marked `$` or `USD`, within `tolerance` of the expected one. */
export const matchesCost = (
  answer: string,
  expected: number,
  tolerance = 0.01,
): boolean =>
  figuresIn(answer).some(
    (figure) =>
      (figure.dollar || figure.unit === 'money') &&
      figure.unit !== 'k' &&
      figure.unit !== 'm' &&
      // Stryker disable next-line EqualityOperator: equivalent because the 1e-12 allowance makes the bound inclusive either way
      Math.abs(figure.value - expected) <=
        tolerance * Math.abs(expected) + 1e-12,
  );
