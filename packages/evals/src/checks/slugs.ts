/** `author/name`, with an optional `:variant`. The same shape as an OpenRouter model slug. */
const SLUG =
  /(?<![\w./:~-])([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._~-]*)(?::([a-z0-9][a-z0-9._-]*))?/gi;

const URL_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const TRAILING_PUNCTUATION = /[._-]+$/;

interface Found {
  slug: string;
  author: string;
  /** The slug is written between backticks. */
  quoted: boolean;
  /** Where the token starts, in the text with its URLs left out. */
  start: number;
}

// Stryker disable next-line StringLiteral: equivalent because a URL ends at whitespace, so no token touches it, and every caller reads the same text
const withoutUrls = (text: string): string => text.replace(URL_TEXT, ' ');

/** A token is a model mention when its author is known or it is in backticks. That keeps `input/output` and `24/7` out. */
const isModelMention = (found: Found, authors: ReadonlySet<string>): boolean =>
  found.quoted || authors.has(found.author);

/** Every slug-shaped token of the text, in order, with URLs left out. */
const scan = (text: string): Found[] => {
  const plain = withoutUrls(text);
  return [...plain.matchAll(SLUG)].map((match) => {
    const whole = match[0];
    const author = match[1] as string;
    const name = match[2] as string;
    const variant = match[3];
    const start = match.index;
    const trimmed = name.replace(TRAILING_PUNCTUATION, '');
    const suffix = variant?.replace(TRAILING_PUNCTUATION, '');
    return {
      slug: `${author}/${trimmed}${suffix ? `:${suffix}` : ''}`.toLowerCase(),
      author: author.toLowerCase(),
      quoted: plain[start - 1] === '`' && plain[start + whole.length] === '`',
      start,
    };
  });
};

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * The models an answer names. A token counts when its author is one of
 * `authors`, or when it is written between backticks. That keeps `input/output`
 * and `24/7` out.
 */
export const namedModels = (
  answer: string,
  authors: ReadonlySet<string>,
): string[] =>
  unique(
    scan(answer)
      .filter((found) => isModelMention(found, authors))
      .map((found) => found.slug),
  );

/** The text up to the first model it names, or all of it when it names none. URLs are left out. */
export const beforeNextModel = (
  text: string,
  authors: ReadonlySet<string>,
): string => {
  const plain = withoutUrls(text);
  const next = scan(plain).find((found) => isModelMention(found, authors));
  return next ? plain.slice(0, next.start) : plain;
};

/** Every slug-shaped token of a source text, whoever the author. */
export const slugTokens = (text: string): string[] =>
  unique(scan(text).map((found) => found.slug));

/** The authors of a list of slugs. */
export const authorsOf = (slugs: Iterable<string>): Set<string> =>
  new Set(
    [...slugs]
      .filter((slug) => slug.includes('/'))
      .map((slug) => slug.slice(0, slug.indexOf('/'))),
  );

/**
 * A slug without a suffix is grounded by the same slug with any suffix. A
 * slug with a suffix needs the same suffix in a source.
 */
export const isGrounded = (
  slug: string,
  sources: ReadonlySet<string>,
): boolean => {
  if (sources.has(slug)) return true;
  return [...sources].some((source) => source.startsWith(`${slug}:`));
};
