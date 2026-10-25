# error-guidance Specification

## Purpose
Makes every error say what is wrong and what to do about it, in the user's terms and never the program's, so that nobody needs the source or the docs to recover.

## Requirements

### Requirement: Cause and remedy
Every error message for a mistake in the arguments, the input or the settings SHALL name what is wrong and what to do about it: the flag to pass, the variable to set, or the value to change. A message SHALL NOT quote the parser's own wording. The same text SHALL appear as `error.message` under `--json`.

#### Scenario: Every usage and configuration error is covered
- **WHEN** each condition in the tables below is provoked
- **THEN** the message equals the one the table gives for it

### Requirement: Usage error messages
The CLI SHALL give these messages for usage errors. `<arg>` is the argument as typed. Each message is followed by the help text, as `cli-help` defines.

#### Scenario: Messages

| Condition | Message |
| --- | --- |
| `-q` without a value | `-q needs a value, the question. Example: -q "What is a token?". Or leave -q out and pipe the question in.` |
| `--model` without a value, or followed by another flag | `--model needs a value, a model slug. Example: --model openai/gpt-4o-mini` |
| Unknown option | `Unknown option '<arg>'. The options this tool accepts are listed below.` |
| Positional argument | `Unexpected argument '<arg>'. Quote the question and pass it with -q, or pipe it in.` |
| A switch given a value, as `--json=1` | `<flag> takes no value. Write <flag> alone.` |
| `--thinking` with `--no-thinking` | `Use either --thinking or --no-thinking, not both. Remove one.` |
| No `-q`, stdin is a terminal | `No question given. Pass it with -q "your question", or pipe it in.` |
| No `-q`, stdin is empty | `No question given. Standard input is empty. Pass -q "your question", or pipe the question in.` |
| `-q` is empty or blank | `The question given with -q is empty. Write the question after -q, or leave -q out and pipe the question in.` |

### Requirement: Configuration error messages
The CLI SHALL give these messages for configuration errors, and no request SHALL be sent. A missing model SHALL name all three ways to supply it (the variable, the `.env` file, `--model`) and show what a model name looks like.

#### Scenario: Messages

| Condition | Message |
| --- | --- |
| No `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY is not set. Set it in the environment or in a .env file in the current directory. Get a key at https://openrouter.ai/keys.` |
| No `--model` and no `OPENROUTER_MODEL` | `No model given. Set OPENROUTER_MODEL in the environment or in a .env file in the current directory, or pass --model <model>. A model is a slug such as openai/gpt-4o-mini; models are listed at https://openrouter.ai/models.` |
| `.env` exists and cannot be read | `Cannot read .env in the current directory: <reason>. Fix its permissions, or remove it and set the variables in the environment.` |
| Some of the three `LANGFUSE_` variables | `Langfuse tracing is half configured: <names> not set. Set all three, or none to run without tracing.` |
| Bad `LANGFUSE_BASE_URL` | the message names the variable and the form it accepts |
| Bad `LANGFUSE_TRACING_ENVIRONMENT` | the message names the variable and the form it accepts |

#### Scenario: Missing model
- **WHEN** the CLI runs with `-q "hi"` and neither `--model` nor `OPENROUTER_MODEL` is given
- **THEN** stderr holds the missing-model message, the exit code is 1, and no request is sent

### Requirement: No implementation details
An error message SHALL speak of the user's arguments, settings, input, network and the services the tool calls. It SHALL NOT show the name of a library, class or file of this tool, a stack trace, an error code of the operating system or the runtime, a validation dump, a raw response body, or the text of an exception it did not write.

#### Scenario: Messages replaced

| Today | Message |
| --- | --- |
| `Unexpected error: <text of whatever was thrown>` | `Something went wrong inside ask-openrouter. Try again. If it keeps happening, report it at https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues, with the output of --verbose.` |
| `Request failed: <client library text>` | `Cannot reach OpenRouter. Check your network connection and try again.` |
| `Request failed: <client library text>`, when the request timed out | `The request to OpenRouter timed out. Try again, or choose another model.` |
| `Stream failed: <client library text>` | `The connection to OpenRouter dropped before the answer was complete.` |
| `The API response did not have the expected shape.` | `OpenRouter sent a reply this tool could not read.` |
| `The API response held no answer.` | `The model returned no answer.` |
| `The API response held no token usage.` | `OpenRouter's reply did not report how many tokens it used.` |
| `The API response held a tool call without an id.` | `The model asked to use a tool in a way this tool cannot follow.` |
| `Cannot read package.json.` or `package.json holds no version.` | `Cannot tell which version of ask-openrouter this is. Reinstall it.` |
| `Cannot read .env … (EACCES)` | `Cannot read .env in the current directory: <reason>. Fix its permissions, or remove it and set the variables in the environment.` where `<reason>` is `permission denied`, `it is a directory`, or `it could not be opened` |

Each of these still takes the remedy of the table that follows, where one applies.

#### Scenario: Whatever was thrown
- **WHEN** the run fails with any thrown value, such as a `TypeError`, a string, or an object with a hostile `toString`
- **THEN** the message is the first row above, exit code 2, `error.code` `UNEXPECTED_ERROR`, and the thrown text appears nowhere in stdout or stderr

#### Scenario: Detail on request
- **WHEN** the run fails unexpectedly with `--verbose`, without `--json`
- **THEN** stderr holds the message, followed by a `detail:` line with the underlying reason, with keys masked as everywhere

#### Scenario: Detail never in JSON
- **WHEN** the run fails unexpectedly with `--json`
- **THEN** the object holds the message of the first row and no detail

### Requirement: The service's own words
When the API rejects a request, the message SHALL quote the status and the message the API sent, on one line, as the service gave it. It SHALL NOT quote the wrapper that the client library adds, a response body that is not a message, or markup.

#### Scenario: API message
- **WHEN** the API answers 401 with the message `No auth credentials found`
- **THEN** the error line holds `401` and `No auth credentials found`

#### Scenario: No message
- **WHEN** the API answers 401 with an empty message
- **THEN** the line is `API error 401: Unauthorized. Check OPENROUTER_API_KEY.`, with the standard reason of the status in place of the missing words

#### Scenario: Reply that is not JSON
- **WHEN** the API answers 502 with an HTML page
- **THEN** the message holds the status and its standard reason and no markup

### Requirement: Remedies for service errors
A failure that the user can act on SHALL end with a remedy on the same line, after the existing text. When the text of the service does not end in `.`, `!`, `?` or `…`, a full stop SHALL come before the remedy. Other service failures keep their text. The remedy SHALL NOT echo a key or a header.

#### Scenario: Remedies

| Failure | Remedy appended |
| --- | --- |
| API status 401 or 403 | ` Check OPENROUTER_API_KEY.` |
| API status 402 | ` Add credits at https://openrouter.ai/settings/credits.` |
| API status 404 | ` If the model is unknown, check the slug passed with --model or set in OPENROUTER_MODEL.` |
| API status 429, retries spent | ` Wait a moment and try again.` |
| API status 5xx, retries spent | ` OpenRouter is having trouble. Try again later.` |
| Request or stream timeout | ` Try again, or choose another model.` |
| Response without answer, tool call id or usage, or of the wrong shape | ` Try again, or choose another model.` |
| Langfuse unreachable, timed out, or answered with another status | ` Check LANGFUSE_BASE_URL and the network, or unset the three LANGFUSE_ variables to run without tracing.` |
| Trace not delivered | ` Check the Langfuse settings and try again.` |

#### Scenario: Bad key
- **WHEN** the API answers 401 with the message `No auth credentials found`
- **THEN** stderr holds the one line `API error 401: No auth credentials found. Check OPENROUTER_API_KEY.`, and the exit code is 2

#### Scenario: Message that ends in a full stop
- **WHEN** the API answers 401 with the message `User not found.`
- **THEN** the line reads `API error 401: User not found. Check OPENROUTER_API_KEY.`, with no second full stop

#### Scenario: Text cut at 200 characters
- **WHEN** the API answers 401 with a message of 201 characters or more, and the text is cut to 200 characters and `…`
- **THEN** the cut text keeps its `…`, no full stop is added, and the remedy follows

#### Scenario: Text of exactly 200 characters without final punctuation
- **WHEN** the API answers 401 with a message of exactly 200 characters that does not end in `.`, `!`, `?` or `…`
- **THEN** the text is kept whole, a full stop follows it, and then the remedy

#### Scenario: Status with no remedy
- **WHEN** the API answers 400 with the message `bad request`
- **THEN** the line is `API error 400: bad request`, and nothing is added

#### Scenario: Remedy stays on one line
- **WHEN** any failure in the table occurs
- **THEN** the message is one line, as `ask-question` requires, and holds no key
