/** The command a user types. */
export const COMMAND = 'ask-openrouter';

const DOCS = 'https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/';

/**
 * Everything a user needs at the terminal: the flags, the settings, the exit
 * codes. It is a pure function of the version, so stdout and stderr print the
 * same bytes. A version that could not be read leaves the title as the name.
 */
export const helpText = (version: string | undefined): string =>
  `${version === undefined ? COMMAND : `${COMMAND} ${version}`}

Ask a question about OpenRouter and find the model that does your job at the lowest cost.

Usage:
  ${COMMAND} -q <question> [options]
  echo <question> | ${COMMAND} [options]

Options:
  -q <question>    The question. Without it, the question is read from standard input.
  --model <model>  The model that answers, a slug such as openai/gpt-4o-mini. Overrides OPENROUTER_MODEL.
  --thinking       Show the model's thinking on stderr, even when stderr is not a terminal.
  --no-thinking    Do not show the thinking, even on a terminal.
  --verbose        Show each tool call the model makes, and the trace id, on stderr.
  --json           Write one JSON object when the run ends: to stdout on success, to stderr on failure.
  -v, --version    Print the version and exit.
  -h, --help       Print this help and exit.

Environment (a .env file in the current directory is read too; the environment wins):
  OPENROUTER_API_KEY            Your OpenRouter key. Required. Get one at https://openrouter.ai/keys.
  OPENROUTER_MODEL              The model that answers when --model is not given.
  LANGFUSE_PUBLIC_KEY           Set it with the next two to trace each run in Langfuse, or leave all three unset.
  LANGFUSE_SECRET_KEY           The secret key of the same Langfuse project.
  LANGFUSE_BASE_URL             Where Langfuse is, such as https://cloud.langfuse.com.
  LANGFUSE_TRACING_ENVIRONMENT  Optional. The environment the traces are filed under.
  LANGFUSE_RELEASE              Optional. The release the traces are attributed to.
  NO_COLOR                      Set to any non-empty value to print the thinking without color.

Exit codes:
  0  Success.
  1  The arguments or the settings are wrong.
  2  The API call failed, timed out, or a trace could not be delivered.
  3  The model kept calling tools past eight rounds.

Examples:
  ${COMMAND} -q "Which model is cheapest for summarizing 2,000 support tickets a day?"
  echo "What is a token?" | ${COMMAND} --model openai/gpt-4o-mini
  ${COMMAND} -q "Compare gpt-4o-mini and claude-haiku on price" --json

Documentation: ${DOCS}
`;
