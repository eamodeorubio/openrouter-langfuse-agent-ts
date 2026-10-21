# ask-question Specification

## Purpose
Answer one question with one OpenRouter model and report which model answered and what it cost in tokens. Defines the CLI's inputs, outputs and exit codes.

## Requirements

### Requirement: Question source
The CLI SHALL take the question from `-q <text>`. Without `-q` it SHALL read the question from stdin. With `-q` it SHALL NOT read stdin. Surrounding whitespace is trimmed.

#### Scenario: Question from -q
- **WHEN** the CLI runs with `-q "What is a token?"`
- **THEN** the model receives `What is a token?`

#### Scenario: Question from stdin
- **WHEN** the CLI runs without `-q` and stdin carries `What is a token?` and a trailing newline
- **THEN** the model receives `What is a token?`

#### Scenario: Question that starts with a dash
- **WHEN** the CLI runs with `-q "-5 degrees in Fahrenheit"`
- **THEN** the model receives `-5 degrees in Fahrenheit`, because `-q` takes the next argument as its value whatever it starts with

#### Scenario: -q wins over stdin
- **WHEN** the CLI runs with `-q "A"` and stdin carries `B`
- **THEN** the model receives `A`

### Requirement: Missing question
The CLI SHALL print a usage message to stderr and exit 1 when no question is available. It SHALL NOT wait on a terminal.

| Condition | Result |
| --- | --- |
| No `-q`, stdin is a terminal | usage, exit 1 |
| No `-q`, stdin is empty or whitespace | usage, exit 1 |
| `-q ""` or `-q "   "` | usage, exit 1 |
| `-q` without a value | usage, exit 1 |

#### Scenario: Nothing to ask
- **WHEN** the CLI runs without `-q` and stdin is a terminal
- **THEN** stderr holds the usage message, stdout is empty, the exit code is 1, and no request is sent

### Requirement: Unknown arguments
The CLI SHALL reject unknown options and positional arguments with a usage message on stderr and exit 1.

#### Scenario: Stray positional
- **WHEN** the CLI runs with `-q "hi" extra`
- **THEN** stderr holds the usage message, the exit code is 1, and no request is sent

### Requirement: Model selection
The CLI SHALL use the model named by `--model`, else by `OPENROUTER_MODEL`. It SHALL have no default. When neither is set or both are blank, it SHALL print a message naming both to stderr and exit 1.

| `--model` | `OPENROUTER_MODEL` | Model used |
| --- | --- | --- |
| `a` | `b` | `a` |
| unset | `b` | `b` |
| `a` | unset | `a` |
| unset | unset | error, exit 1 |

#### Scenario: No model
- **WHEN** neither `--model` nor `OPENROUTER_MODEL` is set
- **THEN** the message names `--model` and `OPENROUTER_MODEL`, the exit code is 1, and no request is sent

### Requirement: API key
The CLI SHALL read the key from `OPENROUTER_API_KEY`. When it is missing or blank, the CLI SHALL print a message naming the variable to stderr and exit 1. No message the CLI writes SHALL contain the key's value. Text the model generates, the answer and its thinking, is passed through as received.

#### Scenario: Missing key
- **WHEN** `OPENROUTER_API_KEY` is unset
- **THEN** stderr names `OPENROUTER_API_KEY`, the exit code is 1, and no request is sent

#### Scenario: Key never printed
- **WHEN** a run fails for any reason with the key set to a known value, and an error from the API or the network echoes that value
- **THEN** no error or status message on stderr contains that value

### Requirement: Environment file
The CLI SHALL load `.env` from the current directory when the file exists. Variables already present in the environment SHALL take precedence. A missing `.env` SHALL NOT be an error.

#### Scenario: Value from .env
- **WHEN** `.env` sets `OPENROUTER_MODEL=m1` and the environment does not
- **THEN** the request uses `m1`

#### Scenario: Environment wins
- **WHEN** `.env` sets `OPENROUTER_MODEL=m1` and the environment sets `m2`
- **THEN** the request uses `m2`

### Requirement: Validation order
The CLI SHALL validate arguments first, then the environment (key and model), and only then read stdin.

#### Scenario: Missing key does not block on a pipe
- **WHEN** the key is unset and no `-q` is given
- **THEN** the CLI exits 1 on the key error without reading stdin

### Requirement: Answer on stdout
The CLI SHALL write the answer text to stdout as it arrives, chunk by chunk, without waiting for the end of the response. When the stream ends it SHALL write one newline and exit 0. Stdout SHALL carry nothing else.

#### Scenario: Clean pipe
- **WHEN** the model streams the chunks `4` and `2`
- **THEN** stdout is exactly `42\n` and the exit code is 0

#### Scenario: First text appears early
- **WHEN** the first answer chunk has arrived and the rest has not
- **THEN** stdout already holds that chunk

### Requirement: Status lines on stderr
After the stream ends, the CLI SHALL write to stderr one `model:` line and one `tokens:` line. The model SHALL be the one the stream reports, not the one requested. Tokens give prompt, completion and total. When the usage reports a non-zero reasoning count, it follows the completion count in parentheses.

```
model: anthropic/claude-sonnet-5.5-20261001
tokens: 12 prompt, 34 completion, 46 total
tokens: 29 prompt, 2024 completion (11 reasoning), 2053 total
```

#### Scenario: Served model differs
- **WHEN** the request names `openrouter/auto` and the stream reports `x/y`
- **THEN** the model line reads `model: x/y`

#### Scenario: Reasoning count
| Usage reports | `tokens:` line |
| --- | --- |
| reasoning 11 | `29 prompt, 2024 completion (11 reasoning), 2053 total` |
| reasoning 0 | `29 prompt, 2024 completion, 2053 total` |
| no reasoning field | `29 prompt, 2024 completion, 2053 total` |

### Requirement: Retry transient failures
The CLI SHALL retry a failed call up to 4 times, 5 attempts in all, when the failure is HTTP 429, HTTP 5xx or a connection error, and only while the model has produced no answer or thinking text, whether or not that text is shown. Before retry n (1 to 4) it SHALL wait 300 ms times 2 to the power n-1, scaled by a random factor between 0.75 and 1.25. It SHALL NOT retry any other failure.

#### Scenario: Which failures are retried
| Failure | Retried |
| --- | --- |
| HTTP 429, 500, 502, 503, 504 | yes |
| Connection error (refused, reset, DNS) | yes |
| Error chunk with code 429 or 5xx, before any output | yes |
| Timeout | no |
| HTTP 400, 401, 402, 403, 404 | no |
| Response without answer or usage | no |
| Any failure after the model has produced answer or thinking text | no |

#### Scenario: Waits before each retry
| Retry | Base wait | Range |
| --- | --- | --- |
| 1 | 300 ms | 225 to 375 ms |
| 2 | 600 ms | 450 to 750 ms |
| 3 | 1200 ms | 900 to 1500 ms |
| 4 | 2400 ms | 1800 to 3000 ms |

#### Scenario: Recovers after a transient error
- **WHEN** the API answers 503 and then streams a good answer
- **THEN** the CLI sends 2 requests, prints the answer and exits 0

#### Scenario: Gives up after the last retry
- **WHEN** the API answers 503 to every request
- **THEN** the CLI sends 5 requests, writes the last error on one line to stderr and exits 2

#### Scenario: Does not retry a refused key
- **WHEN** the API answers 401
- **THEN** the CLI sends 1 request and exits 2

#### Scenario: Does not retry once output has started
- **WHEN** the stream delivers `Hel` and then the connection drops
- **THEN** the CLI sends 1 request, keeps `Hel` on stdout and exits 2

### Requirement: API failure
When the API call fails before any answer or thinking text was written and no retry is left, the CLI SHALL write a one-line message to stderr, write nothing to stdout, and exit 2.

| Failure | Result |
| --- | --- |
| HTTP error status (401, 429, 500) | message with the status and the API's text, exit 2 |
| Network error or timeout | message naming the cause, exit 2 |

#### Scenario: Unauthorized
- **WHEN** the API answers 401 with an error body
- **THEN** stderr holds one line with the status and the API's message, stdout is empty, the exit code is 2

### Requirement: Unusable response
The CLI SHALL treat a stream that ends without answer text, or without token usage, as an API failure: one-line message on stderr and exit 2. Stdout holds only the answer text already written.

#### Scenario: No choices
- **WHEN** the stream ends with no answer text, or with an empty `choices` list
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, the exit code is 2

#### Scenario: Only thinking
- **WHEN** the stream carries thinking text and no answer text
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, the exit code is 2

#### Scenario: No usage
- **WHEN** the stream carries an answer and ends without token usage
- **THEN** stdout holds the answer and a newline, stderr ends with one line saying the response held no token usage, and the exit code is 2

### Requirement: Failure after output has started
When the stream fails after answer or thinking text was written, the CLI SHALL keep what it wrote, end an unfinished stdout line with one newline, write a one-line message to stderr, and exit 2. It SHALL NOT retry.

#### Scenario: Failures after output
| Failure | stdout | stderr | Exit |
| --- | --- | --- | --- |
| Error chunk after `Hel` | `Hel\n` | one line with the code and message | 2 |
| Connection dropped after `Hel` | `Hel\n` | one line naming the cause | 2 |
| No chunk for 60 s after `Hel` | `Hel\n` | one line saying it timed out | 2 |

#### Scenario: Error chunk
- **WHEN** a chunk carries an `error` with code 500 and message `provider failed`
- **THEN** stderr holds one line with `500` and `provider failed`

### Requirement: Stream timeouts
The CLI SHALL fail when no chunk arrives within 60 s of sending the request, or within 60 s of the previous chunk. It SHALL NOT limit the total duration of a stream that keeps delivering chunks. A timeout is not retried.

#### Scenario: Silent server
- **WHEN** the server accepts the request and sends no chunk for 60 s
- **THEN** the CLI exits 2 with a message that says it timed out

#### Scenario: Long stream
- **WHEN** chunks keep arriving at intervals under 60 s for longer than 60 s in all
- **THEN** the stream completes and the CLI exits 0

### Requirement: Thinking output
The CLI SHALL write the model's readable thinking text to stderr as it arrives and never to stdout, when thinking is shown. Encrypted reasoning and summary-only reasoning SHALL NOT be written.

#### Scenario: When thinking is shown
| Flag | stderr is a terminal | Thinking shown |
| --- | --- | --- |
| none | yes | yes |
| none | no | no |
| `--thinking` | yes or no | yes |
| `--no-thinking` | yes or no | no |

#### Scenario: Thinking, then answer
- **WHEN** thinking is shown and the model streams thinking text and then answer text
- **THEN** the thinking text appears on stderr, the answer text on stdout, and stdout holds only the answer

#### Scenario: Nothing readable
- **WHEN** the model returns only encrypted or summary reasoning details
- **THEN** nothing is written for them

### Requirement: Thinking style
When thinking text is written to a terminal, the CLI SHALL dim it, unless `NO_COLOR` is set to a non-empty value, in which case it SHALL write plain text. It SHALL write no styling when stderr is not a terminal. After the last thinking text it SHALL end the line, and when stdout is a terminal it SHALL add one blank line before the answer.

#### Scenario: Dimmed on a terminal
- **WHEN** thinking is written to a terminal and `NO_COLOR` is unset
- **THEN** the text is wrapped in the dim escape sequence and the reset sequence

#### Scenario: Plain text
| stderr is a terminal | `NO_COLOR` | Output |
| --- | --- | --- |
| yes | unset or empty | dimmed |
| yes | non-empty | plain |
| no (`--thinking` given) | any | plain |

### Requirement: Thinking flags
The CLI SHALL accept `--thinking` and `--no-thinking`. Giving both SHALL print a usage message to stderr and exit 1. The usage message SHALL list both flags.

#### Scenario: Both flags
- **WHEN** the CLI runs with `-q "hi" --thinking --no-thinking`
- **THEN** stderr holds the usage message, the exit code is 1, and no request is sent

### Requirement: Complete response instead of a stream
When the server answers with one complete response instead of a stream, the CLI SHALL treat it as a stream of a single chunk. The thinking (when shown) and the answer are written as for a stream, the status lines follow, and the exit code is 0. Only plain text counts as answer text. A complete response without answer text, or without token usage, fails as a stream does.

#### Scenario: Complete response
- **WHEN** the server answers `-q "hi"` with a complete response that holds the answer `pong`, some thinking, and usage with a reasoning count
- **THEN** stdout is `pong\n`, the thinking follows the rules for streamed thinking, the status lines follow on stderr, and the exit code is 0

#### Scenario: Complete response with content in parts
- **WHEN** the server answers with a complete response whose message content is a list of parts and not plain text
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, and the exit code is 2

#### Scenario: Complete response without an answer
- **WHEN** the server answers with a complete response whose `choices` list is empty
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, and the exit code is 2
