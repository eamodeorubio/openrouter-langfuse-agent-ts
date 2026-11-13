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
}

/** Every slug-shaped token of the text, in order, with URLs left out. */
const scan = (text: string): Found[] => {
  // Stryker disable next-line StringLiteral: equivalent because a URL ends at whitespace, so no token touches it
  const plain = text.replace(URL_TEXT, ' ');
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
      .filter((found) => found.quoted || authors.has(found.author))
      .map((found) => found.slug),
  );

/** Every slug-shaped token of a source text, whoever the author. */
export const slugTokens = (text: string): string[] =>
  unique(scan(text).map((found) => found.slug));

/** The authors of a list of slugs. */
export const authorsOf = (slugs: Iterable<string>): Set<string> =>
  new Set([...slugs].map((slug) => slug.slice(0, slug.indexOf('/'))));

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
