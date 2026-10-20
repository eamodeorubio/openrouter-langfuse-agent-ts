# Spec Delta

## Purpose

Answer one question with one OpenRouter model and report which model answered and what it cost in tokens. Defines the CLI's inputs, outputs and exit codes.

## ADDED Requirements

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
The CLI SHALL read the key from `OPENROUTER_API_KEY`. When it is missing or blank, the CLI SHALL print a message naming the variable to stderr and exit 1. No output SHALL contain the key's value.

#### Scenario: Missing key
- **WHEN** `OPENROUTER_API_KEY` is unset
- **THEN** stderr names `OPENROUTER_API_KEY`, the exit code is 1, and no request is sent

#### Scenario: Key never printed
- **WHEN** a run fails for any reason with the key set to a known value
- **THEN** neither stdout nor stderr contains that value

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
On success the CLI SHALL write the answer to stdout followed by one newline, and exit 0. Stdout SHALL carry nothing else.

#### Scenario: Clean pipe
- **WHEN** the model answers `42`
- **THEN** stdout is exactly `42\n` and the exit code is 0

### Requirement: Status lines on stderr
On success the CLI SHALL write to stderr one `model:` line and one `tokens:` line. The model SHALL be the one the response reports, not the one requested. Tokens SHALL give prompt, completion and total.

```
model: anthropic/claude-sonnet-5.5-20261001
tokens: 12 prompt, 34 completion, 46 total
```

#### Scenario: Served model differs
- **WHEN** the request names `openrouter/auto` and the response reports `x/y`
- **THEN** the model line reads `model: x/y`

### Requirement: Retry transient failures
The CLI SHALL retry a failed call up to 4 times, 5 attempts in all, when the failure is HTTP 429, HTTP 5xx or a connection error. Before retry n (1 to 4) it SHALL wait 300 ms times 2 to the power n-1, scaled by a random factor between 0.75 and 1.25. It SHALL NOT retry any other failure.

#### Scenario: Which failures are retried
| Failure | Retried |
| --- | --- |
| HTTP 429, 500, 502, 503, 504 | yes |
| Connection error (refused, reset, DNS) | yes |
| Timeout | no |
| HTTP 400, 401, 402, 403, 404 | no |
| Response without answer or usage | no |

#### Scenario: Waits before each retry
| Retry | Base wait | Range |
| --- | --- | --- |
| 1 | 300 ms | 225 to 375 ms |
| 2 | 600 ms | 450 to 750 ms |
| 3 | 1200 ms | 900 to 1500 ms |
| 4 | 2400 ms | 1800 to 3000 ms |

#### Scenario: Recovers after a transient error
- **WHEN** the API answers 503 and then 200
- **THEN** the CLI sends 2 requests, prints the answer and exits 0

#### Scenario: Gives up after the last retry
- **WHEN** the API answers 503 to every request
- **THEN** the CLI sends 5 requests, writes the last error on one line to stderr and exits 2

#### Scenario: Does not retry a refused key
- **WHEN** the API answers 401
- **THEN** the CLI sends 1 request and exits 2

### Requirement: API failure
When the API call fails and no retry is left, the CLI SHALL write a one-line message to stderr, write nothing to stdout, and exit 2.

| Failure | Result |
| --- | --- |
| HTTP error status (401, 429, 500) | message with the status and the API's text, exit 2 |
| Network error or timeout | message naming the cause, exit 2 |

#### Scenario: Unauthorized
- **WHEN** the API answers 401 with an error body
- **THEN** stderr holds one line with the status and the API's message, stdout is empty, the exit code is 2

### Requirement: Unusable response
The CLI SHALL treat a response without answer text or without token usage as an API failure: one-line message on stderr, empty stdout, exit 2.

#### Scenario: No choices
- **WHEN** the response has an empty `choices` list
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, the exit code is 2

#### Scenario: No usage
- **WHEN** the response has an answer but no usage
- **THEN** the exit code is 2 and stdout is empty
