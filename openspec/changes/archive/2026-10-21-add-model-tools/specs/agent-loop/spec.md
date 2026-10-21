# Spec Delta

## Purpose

Defines how one question becomes several requests to the LLM when the model calls tools, while the user sees one prompt and one answer.

## ADDED Requirements

### Requirement: Instructions and tools in every request
Every request SHALL start with a system message and SHALL offer the tools `get_model`, `search_models` and `calculate`, with parallel tool calls enabled. The system message SHALL tell the model its job (answer questions about OpenRouter, weigh models by cost against need), that prices are USD per million tokens, to prefer tool data over memory, to do arithmetic with `calculate` and show its formula and result when it states a cost, and to call independent tools together.

#### Scenario: First request
- **WHEN** the CLI asks `-q "cheapest model with 1M context?"`
- **THEN** the request holds a system message, then the user message, and lists exactly the three tools

### Requirement: Rounds until the model answers
When a response ends with tool calls, the CLI SHALL run them, append the results and send another request. It SHALL stop when a response holds no tool calls. The text of that response is the answer. Text streamed in earlier rounds SHALL also reach stdout as it arrives.

#### Scenario: One tool, one answer
- **WHEN** round 1 ends with a `get_model` call and round 2 streams `It costs $3.` with no tool call
- **THEN** 2 chat requests were sent, stdout ends with `It costs $3.\n`, and the exit code is 0

#### Scenario: Text from two rounds
- **WHEN** round 1 streams `Checking.` and a tool call, and round 2 streams `Done.`
- **THEN** stdout is `Checking.\nDone.\n`

### Requirement: Parallel tool calls
The CLI SHALL start every tool call of a round at once and wait for all of them. It SHALL append one tool message per call, in the order the model gave the calls, each carrying that call's id.

#### Scenario: Two calls, slow first
- **WHEN** a round holds calls A then B, and B finishes first
- **THEN** the next request lists the result of A, then the result of B

#### Scenario: Concurrent start
- **WHEN** a round holds two calls and the API answers neither until both were requested
- **THEN** the run completes

### Requirement: Reasoning continuity
The assistant message the CLI appends after a round SHALL carry the round's text, its tool calls and its reasoning details exactly as the model sent them. Reasoning details streamed in fragments SHALL be joined without loss. The CLI SHALL NOT alter, drop, reorder or print encrypted or signed blocks. The one addition: a block of a complete (non-streamed) response that has no index is sent with its position as its index, so that two such blocks stay apart.

#### Scenario: Details returned
- **WHEN** round 1 streams reasoning details in 3 fragments and a tool call
- **THEN** the round 2 request holds one assistant message whose reasoning details equal the joined fragments, byte for byte

### Requirement: Round limit
The CLI SHALL allow at most 8 rounds that end in tool calls. The request after the eighth SHALL forbid tools. If the model still calls a tool, the CLI SHALL exit 3 with a one-line message on stderr saying the model kept calling tools. Text already written stays.

#### Scenario: Endless caller
- **WHEN** the model calls a tool in every response
- **THEN** 9 requests were sent, the last with tools forbidden, stderr holds the message, and the exit code is 3

### Requirement: Tool failures go to the model
A tool call that fails SHALL NOT fail the run. The CLI SHALL return the failure to the model as that call's result, in one line, so the model can retry or answer.

#### Scenario: Which failures reach the model
| Condition | Result sent to the model |
| --- | --- |
| Arguments are not valid JSON | error naming the problem |
| Arguments fail validation | error naming the argument |
| Unknown tool name | error listing the known names |
| Models API answers 404 | error saying the model was not found |
| Models API fails otherwise, retries spent | error with status and message |
| Expression is not valid arithmetic, or divides by zero | error naming the cause, as in `calculator` |

#### Scenario: Unknown slug
- **WHEN** the model calls `get_model` with a slug the API answers 404 for
- **THEN** the next request holds a tool result saying the model was not found, and the run continues

### Requirement: Malformed tool call
A tool call that arrives without an id SHALL fail the run as an API failure: one line on stderr, exit 2. No tool SHALL run and no further request SHALL be sent, since the API would refuse a result it cannot match to a call.

#### Scenario: Call without an id
- **WHEN** a response ends with a tool call whose id is empty
- **THEN** stderr holds one line saying the response held a tool call without an id, no tool ran, and the exit code is 2

### Requirement: Tool activity on stderr
With `--verbose`, and only then, the CLI SHALL write for each tool call one line to stderr, before the call runs: `tool: <name> <arguments>`, the arguments as received, on one line (a run of whitespace becomes one space), cut at 200 characters with `…`. Stdout SHALL NOT carry it. The lines do not depend on `--thinking`.

```
tool: get_model {"slug":"openai/gpt-5"}
tool: search_models {"sort":"pricing-low-to-high","limit":5}
```

#### Scenario: Two parallel calls with --verbose
- **WHEN** a round holds two calls
- **THEN** stderr holds two `tool:` lines before either call finishes, and stdout holds none of them

#### Scenario: Without --verbose
- **WHEN** a round holds two calls and `--verbose` is not given
- **THEN** stderr holds no `tool:` line

### Requirement: Retry applies to each request
The retry rule of `ask-question` SHALL apply to each chat request on its own. A request that failed before producing text SHALL be retried even when earlier rounds wrote text. Tool API calls SHALL follow the same retry rule and wait times.

#### Scenario: Round 2 recovers
- **WHEN** round 1 wrote `Checking.` and a tool call, and the round 2 request gets 503 then succeeds
- **THEN** 3 chat requests were sent, `Checking.` was written once, and the exit code is 0
