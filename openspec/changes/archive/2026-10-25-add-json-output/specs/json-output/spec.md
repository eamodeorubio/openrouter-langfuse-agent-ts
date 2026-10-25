# Spec Delta

## Purpose

Lets a script run the CLI and read the outcome as one JSON object, whether the run succeeded or failed, and gives users a JSON Schema to check that object against. While the flag is on, this capability takes precedence over the output rules of `ask-question`.

## ADDED Requirements

### Requirement: Json flag
The CLI SHALL accept `--json` and list it in the usage message. Without it, behavior is unchanged.

#### Scenario: Flag accepted
- **WHEN** the CLI runs with `-q "hi" --json` and the model answers `pong`
- **THEN** the run proceeds and exits 0

### Requirement: One object, written at the end
Under `--json` the CLI SHALL write exactly one JSON object, followed by one newline, after the run has ended. It SHALL write nothing to stdout or stderr before then. The model's stream is still read as a stream.

#### Scenario: Nothing early
- **WHEN** the model has streamed `Hel` and the rest has not arrived
- **THEN** stdout and stderr are empty

### Requirement: Success object
On success the CLI SHALL write the object to stdout, stderr SHALL stay empty, and the exit code SHALL be 0.

#### Scenario: Fields

| Field | Type | Value |
| --- | --- | --- |
| `question` | string | the question as the model received it (trimmed) |
| `answer` | string | the full answer text |
| `success` | boolean | `true` |
| `model` | string | the model that served the final response |
| `usage` | object | the tokens and cost of the question, see "Model and usage" |
| `thinking` | string | the readable thinking text; omitted when there is none |
| `traceId` | string | the Langfuse trace id; omitted when the run is not traced |

The success object has no `error` field.

#### Scenario: Plain answer
- **WHEN** the model `x/y` answers `4` to `-q "2+2"`, with no thinking, usage 12 prompt, 34 completion and 46 total tokens without a cost, and tracing is off
- **THEN** stdout is one line that parses to `{"question":"2+2","answer":"4","success":true,"model":"x/y","usage":{"promptTokens":12,"completionTokens":34,"totalTokens":46}}`

#### Scenario: Thinking and trace
- **WHEN** the model streams the thinking `Add.` and the answer `4`, and the run is traced as `abc123`
- **THEN** the object holds `"thinking":"Add."` and `"traceId":"abc123"`

#### Scenario: Thinking regardless of display flags
- **WHEN** the model thinks and the CLI runs with `--no-thinking`, or with stderr not a terminal
- **THEN** the object holds the thinking text

#### Scenario: Several rounds
- **WHEN** the answer follows tool calls, with text in more than one round
- **THEN** `answer` is the text the answer would have shown on stdout without `--json`, minus the final newline

### Requirement: Model and usage
The success object SHALL name in `model` the model that served the final response, as the `model:` line does without `--json`. `usage` SHALL add up the usage of every request of the question. `cost` SHALL be present only when every one of those requests reported a cost.

#### Scenario: Usage fields

| Field of `usage` | Type | Value |
| --- | --- | --- |
| `promptTokens` | integer | sum over the requests |
| `completionTokens` | integer | sum over the requests |
| `totalTokens` | integer | sum over the requests |
| `reasoningTokens` | integer | sum, present when at least one request reported it |
| `cachedTokens` | integer | sum of the prompt tokens the provider served from its cache, present when at least one request reported it |
| `cost` | number | sum in US dollars, present only when every request reported one |

#### Scenario: Two rounds
- **WHEN** round 1 reports 10 prompt, 5 completion and 15 total tokens and a cost of 0.001, and round 2 reports 30 prompt, 8 completion and 38 total tokens and a cost of 0.002
- **THEN** `usage` holds `"promptTokens":40`, `"completionTokens":13`, `"totalTokens":53` and a `cost` of 0.003

#### Scenario: Cost reported for some requests
- **WHEN** round 1 reports a cost and round 2 reports none
- **THEN** `usage` has no `cost` field

#### Scenario: Optional counts
| Rounds report | `usage` holds |
| --- | --- |
| reasoning 11 in one round, none in the other | `"reasoningTokens":11` |
| reasoning 0 | `"reasoningTokens":0` |
| no reasoning, no cached count | neither field |
| cached 7 and cached 3 | `"cachedTokens":10` |

#### Scenario: Model differs from the one asked for
- **WHEN** the request names `openrouter/auto` and the final response reports `x/y`
- **THEN** `model` is `x/y`

### Requirement: Failure object without model and usage
The failure object SHALL NOT carry `model` or `usage`.

#### Scenario: Run fails after a response
- **WHEN** the first round answers with a tool call and usage, and the second request fails
- **THEN** the failure object has no `model` and no `usage`

### Requirement: Failure object
On failure the CLI SHALL write the object to stderr, stdout SHALL stay empty, and the exit code SHALL be the one `ask-question` assigns. `error.message` SHALL be the message the CLI would have written without `--json`, usage text left out.

#### Scenario: Fields

| Field | Type | Value |
| --- | --- | --- |
| `question` | string | the question; omitted when the failure came before it was known |
| `answer` | string | the text written before the failure; omitted when none |
| `success` | boolean | `false` |
| `thinking` | string | as for success, up to the failure; omitted when none |
| `traceId` | string | as for success; omitted when none |
| `error` | object | `code` and `message` |

#### Scenario: Refused key
- **WHEN** the API answers 401 with the message `No auth`
- **THEN** stdout is empty, stderr holds one object with `"success":false`, no `answer` field, `error.code` `API_ERROR` and a message holding `401` and `No auth`, and the exit code is 2

#### Scenario: Failure after output began
- **WHEN** the stream delivers `Hel` and then the connection drops
- **THEN** the object holds `"answer":"Hel"`, `"success":false` and `error.code` `API_ERROR`, and the exit code is 2

### Requirement: Error codes
`error.code` SHALL be a string of capital letters and underscores, never a number, drawn from this table. The exit code is the one `ask-question` assigns to the same failure.

#### Scenario: Code table

| Failure | `error.code` | Exit |
| --- | --- | --- |
| Bad arguments, no question | `USAGE_ERROR` | 1 |
| Missing or blank key or model, unreadable `.env`, bad Langfuse settings | `CONFIG_ERROR` | 1 |
| HTTP error status from the API | `API_ERROR` | 2 |
| Langfuse rejects the keys or does not answer at startup | `API_ERROR` | 2 |
| Error chunk, broken stream, response of the wrong shape, no answer, no usage | `API_ERROR` | 2 |
| No data within the idle limit | `TIMEOUT` | 2 |
| Round limit reached | `LIMIT_EXCEEDED` | 3 |
| Any other error | `UNEXPECTED_ERROR` | 2 |
| Trace could not be sent after a clean run | `TRACE_FLUSH_FAILED` | 2 |

#### Scenario: Codes map to exit codes
- **WHEN** a run ends in each failure of the table
- **THEN** stderr holds an object with that row's code and the process exits with that row's exit code

#### Scenario: Round limit
- **WHEN** the model calls a tool in every response
- **THEN** `error.code` is `LIMIT_EXCEEDED` and the exit code is 3

### Requirement: Flag errors still report as JSON
When `--json` is among the arguments and the arguments are otherwise invalid, the CLI SHALL write the failure object, with `USAGE_ERROR`, to stderr. When `--json` is absent from the arguments, it SHALL write the usage message as before.

#### Scenario: Both thinking flags
- **WHEN** the CLI runs with `-q "hi" --json --thinking --no-thinking`
- **THEN** stderr holds one failure object with `USAGE_ERROR` and no `question` field, and the exit code is 1

### Requirement: Lost trace after a successful run
When the trace cannot be sent after a run that succeeded, stdout SHALL keep the success object, stderr SHALL hold a failure object with `TRACE_FLUSH_FAILED`, and the exit code SHALL be 2.

#### Scenario: Flush fails
- **WHEN** the answer was written and the Langfuse endpoint refuses the export
- **THEN** stdout holds the success object, stderr holds one object with `TRACE_FLUSH_FAILED`, and the exit code is 2

#### Scenario: Flush fails after a failed run
- **WHEN** the run failed and the Langfuse endpoint refuses the export
- **THEN** stderr holds only the failure object of the run, with its own code, and the exit code is the run's

### Requirement: Nothing else is written
Under `--json` the CLI SHALL NOT write the `tool:` lines, the `trace:` line, the status lines, the thinking stream or the "tracing is off" notice. `--verbose`, `--thinking` and `--no-thinking` are accepted and change nothing in the output.

#### Scenario: Verbose is silent
- **WHEN** the CLI runs with `--json --verbose` and the model calls a tool
- **THEN** stderr is empty and stdout holds only the object

### Requirement: Secrets stay out
No object SHALL contain the value of `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` in an error message. The answer and the thinking are passed through as received.

#### Scenario: Key echoed by the API
- **WHEN** an API error message echoes the key
- **THEN** the key does not appear in the object

### Requirement: Published JSON Schema
The project SHALL publish a JSON Schema (draft 2020-12) of the object in the documentation site, at a fixed path, and show it on the output page. Every object the CLI writes SHALL validate against it. The schema SHALL reject a success object with an `error` field, a failure object without one, and any field not in the tables, and SHALL require `error.code` to match `^[A-Z]+(_[A-Z]+)*$`.

#### Scenario: Output validates
- **WHEN** the CLI writes a success object, and a failure object for each row of the code table
- **THEN** each validates against the published schema

#### Scenario: Wrong objects are rejected
| Object | Valid |
| --- | --- |
| `success` true with an `error` field | no |
| `success` false without `error` | no |
| `error.code` `404` or `api_error` | no |
| an extra field that is not in the tables | no |
| a success object without `model` or without `usage` | no |
| `usage` with a fractional or negative count, a negative `cost`, or a field not in the table | no |
| a failure object with `model` or `usage` | no |
| `{"question":"q","answer":"a","success":true,"model":"x/y","usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3}}` | yes |

#### Scenario: Id pinned to the release
- **WHEN** the schema is read at release `X.Y.Z`
- **THEN** its `$id` is `https://raw.githubusercontent.com/eamodeorubio/openrouter-langfuse-agent-ts/vX.Y.Z/docs/public/schemas/json-output.schema.json`

#### Scenario: Page and file agree
- **WHEN** the docs site is built
- **THEN** the schema shown on the page is the content of the published file

### Requirement: Valid JSON for any text
The object SHALL parse as JSON whatever the question, answer or thinking holds, including quotes, newlines, control characters and non-ASCII text.

#### Scenario: Awkward text
- **WHEN** the answer holds `"`, `\`, a newline and an emoji
- **THEN** the output parses and `answer` equals the text
