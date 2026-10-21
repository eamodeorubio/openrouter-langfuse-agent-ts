# Spec Delta

## ADDED Requirements

### Requirement: Verbose flag
The CLI SHALL accept `--verbose`. It SHALL list the flag in the usage message. It turns on the `tool:` lines of `agent-loop` and nothing else.

#### Scenario: Flag accepted
- **WHEN** the CLI runs with `-q "hi" --verbose`
- **THEN** the run proceeds as without the flag, plus the `tool:` lines

### Requirement: Exit codes
The CLI SHALL exit with the code in the table.

| Code | Meaning |
| --- | --- |
| 0 | the answer was written |
| 1 | usage or configuration error |
| 2 | model, API or network error, including a timeout |
| 3 | stopped by a limit, such as the round limit of `agent-loop` |

#### Scenario: Limit is not an API error
- **WHEN** the model calls a tool in every response
- **THEN** the exit code is 3, not 2

## MODIFIED Requirements

### Requirement: Status lines on stderr
After the final response ends, the CLI SHALL write to stderr one `model:` line and one `tokens:` line. The model SHALL be the one the final response reports, not the one requested. Tokens give prompt, completion and total, each summed over every request of the question. When the summed reasoning count is non-zero, it follows the completion count in parentheses.

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

#### Scenario: Two rounds
- **WHEN** round 1 reports 10 prompt, 5 completion, 15 total and round 2 reports 30 prompt, 8 completion, 38 total
- **THEN** the line reads `tokens: 40 prompt, 13 completion, 53 total`

### Requirement: Retry transient failures
The CLI SHALL retry a failed request up to 4 times, 5 attempts in all, when the failure is HTTP 429, HTTP 5xx or a connection error, and only while that request has produced no answer or thinking text, whether or not that text is shown. Before retry n (1 to 4) it SHALL wait 300 ms times 2 to the power n-1, scaled by a random factor between 0.75 and 1.25. It SHALL NOT retry any other failure.

#### Scenario: Which failures are retried
| Failure | Retried |
| --- | --- |
| HTTP 429, 500, 502, 503, 504 | yes |
| Connection error (refused, reset, DNS) | yes |
| Error chunk with code 429 or 5xx, before any output | yes |
| Timeout | no |
| HTTP 400, 401, 402, 403, 404 | no |
| Response without answer or usage | no |
| Any failure after the request has produced answer or thinking text | no |

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

### Requirement: Unusable response
The CLI SHALL treat a final response, one with no tool calls, that ends without answer text, or without token usage, as an API failure: one-line message on stderr and exit 2. A response that ends in tool calls needs no answer text, but it still needs token usage. Stdout holds only the answer text already written.

#### Scenario: No choices
- **WHEN** the stream ends with no answer text, or with an empty `choices` list
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, the exit code is 2

#### Scenario: Only thinking
- **WHEN** the stream carries thinking text and no answer text
- **THEN** stderr holds one line saying the response held no answer, stdout is empty, the exit code is 2

#### Scenario: No usage
- **WHEN** the stream carries an answer and ends without token usage
- **THEN** stdout holds the answer and a newline, stderr ends with one line saying the response held no token usage, and the exit code is 2

#### Scenario: Tool calls without text
- **WHEN** a response carries a tool call, no answer text and usage
- **THEN** it is not an API failure and the run continues with the tool result
