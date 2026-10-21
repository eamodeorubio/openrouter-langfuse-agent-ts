/**
 * The most characters an expression may have. Besides bounding the work, it
 * bounds every value: 200 characters cannot write a number near 1e308, so no
 * result is infinite. Raising it needs that argument made again.
 */
export const MAX_LENGTH = 200;
const MAX_DEPTH = 32;
const SIGNIFICANT_DIGITS = 12;
/** What `peek` gives past the end of the text. */
const END = '';

export type Evaluation =
  | { ok: true; formula: string; result: number }
  | { ok: false; message: string };

/** A reason the expression cannot be computed, worded for the model. */
class Rejection extends Error {}

const ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/** The character as it can be shown in a one-line message: a control or line-break character is written as an escape. */
const visible = (char: string): string =>
  ESCAPES[char] ??
  (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(char)
    ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    : char);

interface Term {
  value: number;
  /** The expression as it will be shown: single spaces around binary operators. */
  text: string;
}

/** `char` is one character, or '' past the end of the text. */
const isDigit = (char: string): boolean => char >= '0' && char <= '9';

/**
 * Reads an arithmetic expression by recursive descent and computes it as it
 * goes. The grammar is the whole of what is accepted: decimal numbers, `+`,
 * `-`, `*`, `/`, parentheses, spaces and unary signs. No part of the text is
 * ever run as code, so there is nothing to escape from.
 *
 *   sum     = product (("+" | "-") product)*
 *   product = unary (("*" | "/") unary)*
 *   unary   = ("+" | "-") unary | primary
 *   primary = number | "(" sum ")"
 *
 * The length limit keeps every value far below the largest double (200
 * characters cannot write a number near 1e308), so no result is infinite.
 */
class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): Term {
    const term = this.sum(0);
    if (this.peek() !== END) {
      throw this.unexpected();
    }
    return term;
  }

  /** The next character after any spaces, which are skipped; END at the end. */
  private peek(): string {
    while (this.source.charAt(this.position) === ' ') {
      this.position++;
    }
    return this.source.charAt(this.position);
  }

  /** Positions count characters. Everything the grammar accepts is ASCII, so a character before the first rejected one is always one UTF-16 unit too. */
  private unexpected(): Rejection {
    const char = String.fromCodePoint(
      this.source.codePointAt(this.position) as number,
    );
    return new Rejection(
      `Unexpected character "${visible(char)}" at position ${this.position + 1}.`,
    );
  }

  private sum(depth: number): Term {
    let left = this.product(depth);
    for (;;) {
      const op = this.peek();
      if (op !== '+' && op !== '-') {
        return left;
      }
      this.position++;
      const right = this.product(depth);
      left = {
        value: rounded(
          op === '+' ? left.value + right.value : left.value - right.value,
        ),
        text: `${left.text} ${op} ${right.text}`,
      };
    }
  }

  private product(depth: number): Term {
    let left = this.unary(depth);
    for (;;) {
      const op = this.peek();
      if (op !== '*' && op !== '/') {
        return left;
      }
      this.position++;
      const right = this.unary(depth);
      if (op === '/' && right.value === 0) {
        throw new Rejection('Division by zero.');
      }
      left = {
        value: rounded(
          op === '*' ? left.value * right.value : left.value / right.value,
        ),
        text: `${left.text} ${op} ${right.text}`,
      };
    }
  }

  private unary(depth: number): Term {
    const sign = this.peek();
    if (sign !== '+' && sign !== '-') {
      return this.primary(depth);
    }
    this.position++;
    const operand = this.unary(depth);
    return {
      value: sign === '-' ? -operand.value : operand.value,
      text: `${sign}${operand.text}`,
    };
  }

  private primary(depth: number): Term {
    const char = this.peek();
    if (char === END) {
      throw new Rejection(
        'The expression ends where a number or "(" is expected.',
      );
    }
    if (char === '(') {
      return this.parenthesised(depth);
    }
    if (!isDigit(char)) {
      throw this.unexpected();
    }
    return this.number();
  }

  private parenthesised(depth: number): Term {
    const opening = this.position + 1;
    if (depth >= MAX_DEPTH) {
      throw new Rejection(
        `Parentheses are nested deeper than ${MAX_DEPTH} levels.`,
      );
    }
    this.position++;
    const inner = this.sum(depth + 1);
    const closing = this.peek();
    if (closing === END) {
      throw new Rejection(`Missing ")" for the "(" at position ${opening}.`);
    }
    if (closing !== ')') {
      throw this.unexpected();
    }
    this.position++;
    return { value: inner.value, text: `(${inner.text})` };
  }

  /** Digits, and a decimal point only when digits follow it. */
  private number(): Term {
    const start = this.position;
    while (isDigit(this.source.charAt(this.position))) {
      this.position++;
    }
    if (
      this.source.charAt(this.position) === '.' &&
      isDigit(this.source.charAt(this.position + 1))
    ) {
      this.position++;
      while (isDigit(this.source.charAt(this.position))) {
        this.position++;
      }
    }
    const text = this.source.slice(start, this.position);
    return { value: Number(text), text };
  }
}

/**
 * Twelve significant digits take out binary rounding noise (`0.1 + 0.2` is
 * `0.3`) and keep every catalog price exact. Every step is rounded, not only
 * the last, so that `0.1 + 0.2 - 0.3` is 0 and dividing by it is a division by
 * zero. A zero comes out as 0, never -0.
 */
const rounded = (value: number): number =>
  Number(value.toPrecision(SIGNIFICANT_DIGITS));

/**
 * The number in plain decimal. JavaScript writes 1e-7 and 1e+21 with an
 * exponent, which the grammar would refuse if the model pasted the formula
 * back, so the decimal point is moved in the text. A number written without an
 * exponent goes through the same steps and comes out unchanged.
 */
const plainDecimal = (value: number): string => {
  const [mantissa, exponent] = String(value).split('e') as [
    string,
    string | undefined,
  ];
  const sign = mantissa.startsWith('-') ? '-' : '';
  const unsigned = mantissa.replace('-', '');
  const digits = unsigned.replace('.', '');
  const wholeDigits = unsigned.includes('.')
    ? unsigned.indexOf('.')
    : unsigned.length;
  const point = wholeDigits + Number(exponent ?? 0);
  // `point` counts the digits before the decimal point; below 1 there are none.
  if (point < 1) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

/** Computes the expression, or says why it cannot. Never throws. */
export const evaluate = (expression: string): Evaluation => {
  try {
    if (expression.length > MAX_LENGTH) {
      throw new Rejection(
        `The expression is longer than ${MAX_LENGTH} characters.`,
      );
    }
    if (/^ *$/.test(expression)) {
      throw new Rejection('The expression is empty.');
    }
    const { value, text } = new Parser(expression).parse();
    const result = rounded(value);
    return { ok: true, formula: `${text} = ${plainDecimal(result)}`, result };
  } catch (error) {
    if (error instanceof Rejection) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
};
