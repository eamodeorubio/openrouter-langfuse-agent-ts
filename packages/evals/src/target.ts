const MIN_MAJOR = 1;
const MIN_MINOR = 1;

/** The first version of `ask-openrouter` that lists its tool calls in `--json`, which the checks read. */
export const MIN_CLI_VERSION = `${MIN_MAJOR}.${MIN_MINOR}.0`;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The version a text names, when it is an exact version from 1.1.0: three whole
 * numbers and nothing else. A tag, a range or a pre-release is refused, because
 * the text ends up in the invocation of a process, and because two runs of
 * "latest" would not measure the same code.
 */
export const parseCliVersion = (text: string): string | undefined =>
  cliVersionProblem(text) === undefined ? text : undefined;

/** Why a text is no version to evaluate, or `undefined` when it is one. */
export const cliVersionProblem = (text: string): string | undefined => {
  if (!SEMVER.test(text)) {
    return `--cli-version takes an exact version from ${MIN_CLI_VERSION}, such as ${MIN_CLI_VERSION}, got ${JSON.stringify(text)}. A range, a tag or a pre-release is not accepted.`;
  }
  const [major, minor] = text.split('.').map(Number) as [number, number];
  const accepted =
    major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
  return accepted
    ? undefined
    : `--cli-version ${text} is too old: ask-openrouter lists its tool calls in --json from ${MIN_CLI_VERSION}, and the checks read them. Use ${MIN_CLI_VERSION} or later.`;
};

/** The file beside the results that names what the run evaluated. */
export const TARGET_FILE = 'target.txt';
