# Spec Delta

## ADDED Requirements

### Requirement: Tool calls
The success object, and the failure object of a run that sent its first request to the model, SHALL carry `toolCalls`: one entry per tool call the model made, ordered by round and, within a round, in the order of the model's response. The list is empty when the model made no call. A failure raised before the first request has no `toolCalls`.

#### Scenario: Entry fields

| Field | Type | Value |
| --- | --- | --- |
| `round` | integer | the number of the model response that asked for the call, from 1 |
| `name` | string | the tool name the model sent |
| `arguments` | string | the arguments exactly as the model sent them |
| `output` | string | the text the tool returned to the model, complete |
| `failed` | boolean | `true` when the result was an error, otherwise `false` |

An entry has no other field.

#### Scenario: Parallel and sequential calls
- **WHEN** response 1 asks for `get_model` and `calculate` together, and response 2 asks for `search_models`
- **THEN** `toolCalls` holds three entries with rounds 1, 1 and 2, the first two in the order the model listed them

#### Scenario: Results arrive out of order
- **WHEN** the second of two parallel calls returns before the first
- **THEN** the entries still follow the order of the model's response

#### Scenario: No call
- **WHEN** the model answers without a tool call
- **THEN** the success object holds `"toolCalls":[]`

#### Scenario: Failure before the first request
- **WHEN** the run fails because no API key is set
- **THEN** the failure object has no `toolCalls`

#### Scenario: Failure after calls
- **WHEN** round 1 calls a tool and the second request fails with a 500
- **THEN** the failure object holds the entry of that call and `error.code` `API_ERROR`

### Requirement: Output is never cut
`arguments` and `output` SHALL hold the full text. The CLI SHALL NOT shorten, summarize or cap either. The only change to `output` and `arguments` is the redaction of the secrets.

#### Scenario: Large result
- **WHEN** a tool returns 200 000 characters
- **THEN** `output` holds all 200 000

#### Scenario: Invalid JSON stays visible
- **WHEN** the model sends the arguments `{"slug": ` to `get_model`
- **THEN** `arguments` equals `{"slug": ` and the entry is `failed`

### Requirement: Error results in the list
A call whose result is an error SHALL appear in `toolCalls` with `failed` `true` and the error text as `output`. A call that did not return an error has `failed` `false`.

#### Scenario: Which calls are failed

| Situation | `failed` | `output` |
| --- | --- | --- |
| Unknown tool name | `true` | the text the model received |
| Arguments are not valid JSON | `true` | the text the model received |
| Arguments fail validation | `true` | the text the model received |
| Models API answers 404, a bad status, a timeout or a dropped connection | `true` | the text the model received |
| Expression is not valid arithmetic | `true` | the text the model received |
| The tool returns a value | `false` | the value as JSON text |
| The tool throws | `true` | the message of the error, redacted; the run fails as `UNEXPECTED_ERROR` |
| The model asks for a tool in the round that hits the limit | `true` | `[LIMIT_EXCEEDED] Tool calls limit exceeded` |
| The run failed before the call returned | `true` | `[TOOL_CALL_NOT_COMPLETED] Tool call did not complete` |

Every call the model asked for in a response that started running is listed, with its result or with the last row's output. A call is never left out.

#### Scenario: Validation error
- **WHEN** the model calls `search_models` with `{"limit":500}`
- **THEN** the entry holds those arguments, `failed` `true`, and an `output` naming the `limit` argument, and the run continues

#### Scenario: Limit round
- **WHEN** the model calls a tool in every response
- **THEN** the failure object has `error.code` `LIMIT_EXCEEDED`, and the entries of round 9 have `failed` `true` and the output `[LIMIT_EXCEEDED] Tool calls limit exceeded`

#### Scenario: Tool throws
- **WHEN** a tool throws while another call of the same round is still running
- **THEN** the failure object has `error.code` `UNEXPECTED_ERROR`, lists the call that threw with `failed` `true` and its message as `output`, and lists the call still running with `failed` `true` and the output `[TOOL_CALL_NOT_COMPLETED] Tool call did not complete`

### Requirement: Arguments received
The success object and the failure object SHALL carry `args`, the arguments the CLI parsed. A field that was not set is left out. A failure caused by the arguments themselves has no `args`.

#### Scenario: Fields of args

| Field | Type | Present |
| --- | --- | --- |
| `verbose` | boolean | always; `true` with `--verbose`, otherwise `false` |
| `thinking` | boolean | `true` with `--thinking`, `false` with `--no-thinking`, left out with neither |
| `model` | string | the value of `--model`, left out without it |

`args` has no other field. The question is not repeated in it.

#### Scenario: Flags given
- **WHEN** the CLI runs with `-q "hi" --json --verbose --no-thinking --model x/y`
- **THEN** `args` equals `{"verbose":true,"thinking":false,"model":"x/y"}`

#### Scenario: Nothing given
- **WHEN** the CLI runs with `-q "hi" --json`
- **THEN** `args` equals `{"verbose":false}`

#### Scenario: Configuration failure
- **WHEN** the run fails because no API key is set
- **THEN** the failure object holds `args`

#### Scenario: Arguments rejected
- **WHEN** the CLI runs with `-q "hi" --json --thinking --no-thinking`
- **THEN** the failure object has no `args`

## MODIFIED Requirements

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
| `toolCalls` | array | the tool calls of the run, see "Tool calls"; empty when there are none |
| `args` | object | the arguments received, see "Arguments received" |
| `thinking` | string | the readable thinking text; omitted when there is none |
| `traceId` | string | the Langfuse trace id; omitted when the run is not traced |

The success object has no `error` field.

#### Scenario: Plain answer
- **WHEN** the model `x/y` answers `4` to `-q "2+2" --json`, with no thinking, usage 12 prompt, 34 completion and 46 total tokens without a cost, and tracing is off
- **THEN** stdout is one line that parses to `{"question":"2+2","answer":"4","success":true,"model":"x/y","usage":{"promptTokens":12,"completionTokens":34,"totalTokens":46},"toolCalls":[],"args":{"verbose":false}}`

#### Scenario: Thinking and trace
- **WHEN** the model streams the thinking `Add.` and the answer `4`, and the run is traced as `abc123`
- **THEN** the object holds `"thinking":"Add."` and `"traceId":"abc123"`

#### Scenario: Thinking regardless of display flags
- **WHEN** the model thinks and the CLI runs with `--no-thinking`, or with stderr not a terminal
- **THEN** the object holds the thinking text

#### Scenario: Several rounds
- **WHEN** the answer follows tool calls, with text in more than one round
- **THEN** `answer` is the text the answer would have shown on stdout without `--json`, minus the final newline

### Requirement: Failure object
On failure the CLI SHALL write the object to stderr, stdout SHALL stay empty, and the exit code SHALL be the one `ask-question` assigns. `error.message` SHALL be the message the CLI would have written without `--json`, usage text left out.

#### Scenario: Fields

| Field | Type | Value |
| --- | --- | --- |
| `question` | string | the question; omitted when the failure came before it was known |
| `answer` | string | the text written before the failure; omitted when none |
| `success` | boolean | `false` |
| `toolCalls` | array | as for success, up to the failure; omitted when the failure came before the first request |
| `args` | object | as for success; omitted when the arguments were rejected |
| `thinking` | string | as for success, up to the failure; omitted when none |
| `traceId` | string | as for success; omitted when none |
| `error` | object | `code` and `message` |

#### Scenario: Refused key
- **WHEN** the API answers 401 with the message `No auth`
- **THEN** stdout is empty, stderr holds one object with `"success":false`, no `answer` field, `"toolCalls":[]`, `error.code` `API_ERROR` and a message holding `401` and `No auth`, and the exit code is 2

#### Scenario: Failure after output began
- **WHEN** the stream delivers `Hel` and then the connection drops
- **THEN** the object holds `"answer":"Hel"`, `"success":false` and `error.code` `API_ERROR`, and the exit code is 2

### Requirement: Flag errors still report as JSON
When `--json` is among the arguments and the arguments are otherwise invalid, the CLI SHALL write the failure object, with `USAGE_ERROR`, to stderr. When `--json` is absent from the arguments, it SHALL write the usage message as before.

#### Scenario: Both thinking flags
- **WHEN** the CLI runs with `-q "hi" --json --thinking --no-thinking`
- **THEN** stderr holds one failure object with `USAGE_ERROR`, and no `question`, `args` or `toolCalls` field, and the exit code is 1

### Requirement: Nothing else is written
Under `--json` the CLI SHALL NOT write the `tool:` lines, the `trace:` line, the status lines, the thinking stream or the "tracing is off" notice. `--verbose`, `--thinking` and `--no-thinking` are accepted and change nothing in the output but the `args` they are recorded in.

#### Scenario: Verbose is silent
- **WHEN** the CLI runs with `--json --verbose` and the model calls a tool
- **THEN** stderr is empty, stdout holds only the object, and the object holds the call in `toolCalls` and `"verbose":true` in `args`

### Requirement: Secrets stay out
No object SHALL contain the value of `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` in an error message or in `args`, nor the value of `OPENROUTER_API_KEY` in `toolCalls`. A secret there SHALL be replaced by `[redacted]`. The answer and the thinking are passed through as received.

#### Scenario: Key echoed by the API
- **WHEN** an API error message echoes the key
- **THEN** the key does not appear in the object

#### Scenario: Key in a tool call
- **WHEN** a tool result, or the arguments the model sent, contain the OpenRouter key
- **THEN** the `output` or `arguments` of the entry hold `[redacted]` in its place

#### Scenario: Key in --model
- **WHEN** the value of `--model` contains the OpenRouter key
- **THEN** `args.model` holds `[redacted]` in its place

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
| a success object without `model`, `usage`, `toolCalls` or `args` | no |
| `usage` with a fractional or negative count, a negative `cost`, or a field not in the table | no |
| a failure object with `model` or `usage` | no |
| a `toolCalls` entry with a missing field, an extra field, a `round` below 1 or a non-integer `round` | no |
| `args` without `verbose`, with a non-boolean `thinking`, or with a field not in the table | no |
| `{"question":"q","answer":"a","success":true,"model":"x/y","usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3},"toolCalls":[],"args":{"verbose":false}}` | yes |

#### Scenario: Id pinned to the release
- **WHEN** the schema is read at release `X.Y.Z`
- **THEN** its `$id` is `https://raw.githubusercontent.com/eamodeorubio/openrouter-langfuse-agent-ts/vX.Y.Z/docs/public/schemas/json-output.schema.json`

#### Scenario: Page and file agree
- **WHEN** the docs site is built
- **THEN** the schema shown on the page is the content of the published file
