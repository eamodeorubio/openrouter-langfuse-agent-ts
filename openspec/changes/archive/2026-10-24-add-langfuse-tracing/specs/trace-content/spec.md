# Spec Delta

## Purpose

Defines the tree of observations a traced run exports and what each one carries, so that a reader of the trace sees what the model was shown, what it decided, what each step cost, and nothing secret.

## ADDED Requirements

### Requirement: Observation tree
A traced run SHALL export one trace rooted at an `agent` observation named `answer-question`. Its children, in order, are one `generation` named `generate-response` per request to the model and one `tool` per call, named after the tool (`get_model`, `search_models`, `calculate`). A tool is a sibling of the generation that requested it. Apart from the stream events below, no other observation is exported, and none is of type `span`.

#### Scenario: One tool, two rounds
- **WHEN** round 1 ends with one `get_model` call and round 2 answers
- **THEN** the root has three children in this order: `generate-response`, `get_model`, `generate-response`

#### Scenario: Parallel calls
- **WHEN** a round holds calls A and B
- **THEN** both `tool` observations are children of the root, both start before either ends, and both follow the generation that requested them

#### Scenario: No HTTP noise
- **WHEN** a tool fetches the catalog
- **THEN** the trace holds no observation for the HTTP request

### Requirement: Names are stable
Observation names SHALL NOT contain the model, a round number, an id or any text of the question. Names are verb-first, except tool names, which are the names the model calls.

#### Scenario: Two models, same names
- **WHEN** two runs use different models
- **THEN** their generations have the same name

### Requirement: Root input and output
The root observation SHALL hold the question as input and the final answer text as output. When the run fails before an answer, the output SHALL be empty and the level `ERROR` with the one-line error as status message.

#### Scenario: Answered
- **WHEN** the question `cheapest?` is answered `Model X.`
- **THEN** the trace input is `cheapest?` and the trace output is `Model X.`

### Requirement: Generation content
Each `generation` SHALL carry: the requested model and the model that served it; the full message list sent, as role-labelled messages, with tool calls in the assistant message's `tool_calls` and each tool result matched to its call id; the output as an assistant message with its text and tool calls (arguments as JSON strings); the thinking text; and the finish reason. The system message is included.

#### Scenario: Second round input
- **WHEN** round 2 is sent after one tool call
- **THEN** its input holds system, user, assistant (with `tool_calls`) and tool messages, and the tool message carries the call's id

#### Scenario: Thinking
- **WHEN** the model streams thinking in a round
- **THEN** that generation holds the whole thinking text, whether or not `--thinking` is on

### Requirement: Usage and cost
Each `generation` SHALL carry token counts as non-overlapping buckets: `input`, `input_cached_tokens`, `output`, `output_reasoning_tokens` and `total`, the sum of the others. Cached and reasoning tokens come out of `input` and `output`, unless that would leave a bucket below zero: then the prompt or completion count stays whole and the reported cached or reasoning count goes to metadata. The API's cost in USD is carried when reported. A bucket the API does not report is absent.

#### Scenario: Examples
| API reports | Buckets |
| --- | --- |
| prompt 100, completion 40 | input 100, output 40, total 140 |
| prompt 100 of which cached 30, completion 40 of which reasoning 15 | input 70, input_cached_tokens 30, output 25, output_reasoning_tokens 15, total 140 |
| prompt 25, completion 122, reasoning 128 (a recorded run) | input 25, output 122, total 147; metadata `reasoning_tokens` 128 |
| prompt 10, cached 30, completion 5 | input 10, output 5, total 15; metadata `cached_tokens` 30 |
| cost 0.0021 | cost 0.0021 |
| no cost | no cost |

#### Scenario: Buckets add up and never go below zero
- **WHEN** any usage is reported
- **THEN** every bucket is zero or more, and the buckets other than `total` sum to `total`

### Requirement: Tool content
Each `tool` SHALL carry the arguments as input and the result the model received as output. A tool that fails SHALL have level `ERROR` and the one-line reason as status message; a tool that succeeds has the default level.

#### Scenario: Failing tool
- **WHEN** `calculate` is called with a bad expression
- **THEN** its observation has level `ERROR`, a status message with the reason, and the same text as output

### Requirement: Errors on generations
A request that fails SHALL end its `generation` with level `ERROR`, a status message with the one-line error and the HTTP status when there is one. Each retry SHALL be recorded in the metadata of the generation that was retried, as a count; a retry SHALL NOT create a new generation.

#### Scenario: Retried then served
- **WHEN** a request fails with 503 once and then succeeds
- **THEN** the trace holds one generation for it, with metadata `retries` equal to 1 and the default level

### Requirement: Stream events
A streamed generation SHALL have at most two `event` observations as children: one named `receive-first-token` at the arrival of the first chunk of text or thinking, and one named `fail-stream` when the stream breaks or goes idle. The first token SHALL also set the generation's completion start time, from which Langfuse measures time to first token. Chunks SHALL NOT create events.

#### Scenario: Time to first token
- **WHEN** a generation receives its first token
- **THEN** its completion start time equals the time of its `receive-first-token` event, and a generation that never got a token has none

#### Scenario: A failure that is retried
- **WHEN** a stream breaks before any output and the request is retried
- **THEN** the generation holds no `fail-stream` event for that attempt

#### Scenario: Long stream
- **WHEN** a response arrives in 500 chunks
- **THEN** the generation holds one `receive-first-token` event and no other event

### Requirement: Trace attributes
Every observation SHALL carry the CLI version as `version`. The trace SHALL carry the environment from `LANGFUSE_TRACING_ENVIRONMENT` (default `default`) and the release from `LANGFUSE_RELEASE` (default the CLI version). Run-specific values, such as the retry count and the round index, SHALL be metadata, not names or tags. The trace SHALL NOT carry a session id or a user id.

#### Scenario: Nothing from the machine
- **WHEN** any traced run exports its observations
- **THEN** the service is named `openrouter-langfuse-agent-ts` with the version of the package, and no exported value holds the path of the Node binary, the home directory or the host name

#### Scenario: Version from the package
- **WHEN** `package.json` says version `0.3.0`
- **THEN** every exported observation has `version` `0.3.0`, and with `LANGFUSE_RELEASE` unset the release is `0.3.0`

#### Scenario: Environment from variable
- **WHEN** `LANGFUSE_TRACING_ENVIRONMENT=staging`
- **THEN** the exported trace has environment `staging`

### Requirement: Masking
Everything exported SHALL pass one masking step before it leaves the process. It SHALL replace, wherever they occur in input, output, metadata and status messages: the OpenRouter key, the Langfuse keys, bearer tokens (`Bearer` followed by a token), strings shaped like OpenRouter or Langfuse keys (`sk-or-…`, `sk-lf-…`, `pk-lf-…`), and email addresses. The CLI SHALL NOT export request headers or environment contents.

#### Scenario: Key in a tool result
- **WHEN** a tool result contains the OpenRouter key
- **THEN** the exported tool output contains `[REDACTED]` in its place

#### Scenario: Email in the question
- **WHEN** the question is `mail me at a@b.com`
- **THEN** the exported root input is `mail me at [REDACTED]`, and the model still received the original text

#### Scenario: Headers
- **WHEN** any request is traced
- **THEN** no exported attribute holds an `Authorization` value

### Requirement: Tracing never changes the answer
A fault inside tracing, apart from the credential check and the flush, SHALL NOT change stdout, the answer or the exit code. Exported content SHALL NOT slow the stream: the answer text reaches stdout as it does untraced.

#### Scenario: Observation throws
- **WHEN** recording an observation raises an error
- **THEN** the answer is written and the exit code is 0
