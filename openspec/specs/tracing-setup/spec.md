# tracing-setup Specification

## Purpose
Decides whether a run is traced, proves the Langfuse connection before work starts, and guarantees that a short-lived process delivers its trace before it exits.

## Requirements

### Requirement: Tracing switch
Tracing SHALL be on when `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` are all non-blank, read from the environment and `.env` as `ask-question` says. With none set, the run SHALL be untraced and write one warning line to stderr naming them. With one or two set, the CLI SHALL exit 1 before any request, naming each missing variable.

#### Scenario: Decision table
| Public key | Secret key | Base URL | Result |
| --- | --- | --- | --- |
| set | set | set | traced |
| unset | unset | unset | untraced, one stderr warning, exit as usual |
| any other mix | | | exit 1, stderr names the missing variables, no request sent |

#### Scenario: Untraced run
- **WHEN** none of the three variables is set and the question is answered
- **THEN** stdout holds only the answer, stderr holds the one warning, and no request reaches Langfuse

#### Scenario: Partial credentials
- **WHEN** only `LANGFUSE_PUBLIC_KEY` is set
- **THEN** stderr names `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`, the exit code is 1, and no request is sent to any server

#### Scenario: Partial credentials do not block on a pipe
- **WHEN** only `LANGFUSE_PUBLIC_KEY` is set and no `-q` is given
- **THEN** the CLI exits 1 on the tracing error without reading stdin

#### Scenario: Blank counts as unset
- **WHEN** `LANGFUSE_SECRET_KEY` is `   `
- **THEN** it is treated as unset

### Requirement: Base URL validation
`LANGFUSE_BASE_URL` SHALL be an absolute `http` or `https` URL with no user name and no password. Anything else SHALL exit 1 with a message naming the variable and never echoing the keys.

#### Scenario: Credentials in the URL
- **WHEN** `LANGFUSE_BASE_URL=https://user:pass@cloud.langfuse.com`
- **THEN** stderr names `LANGFUSE_BASE_URL` and does not show `pass`, the exit code is 1, and no request is sent

#### Scenario: Not a URL
- **WHEN** `LANGFUSE_BASE_URL=cloud.langfuse.com`
- **THEN** stderr names `LANGFUSE_BASE_URL`, the exit code is 1, and no request is sent

### Requirement: Credential check before work
A traced run SHALL verify the credentials against the Langfuse server before the first request to the model. A rejected key or an unreachable server SHALL end the run with one stderr line and exit 2, with no request to OpenRouter and nothing on stdout.

| Langfuse answer | Message names | Exit |
| --- | --- | --- |
| 2xx | | continues |
| 401 or 403 | the keys are rejected | 2 |
| other status | the status | 2 |
| no answer within 10 s, or a network error | the base URL | 2 |

#### Scenario: Rejected keys
- **WHEN** Langfuse answers 401
- **THEN** stderr holds one line saying the keys were rejected, no request reaches OpenRouter, and the exit code is 2

#### Scenario: Unreachable
- **WHEN** the connection to the base URL is refused
- **THEN** stderr holds one line naming the base URL, no request reaches OpenRouter, and the exit code is 2

### Requirement: Trace id
Each traced run SHALL have one 32-character lowercase hex trace id, shared by every observation of the run. With `--verbose`, the CLI SHALL write that id to stderr once, when the root observation opens.

#### Scenario: Verbose shows the id
- **WHEN** a traced run uses `--verbose`
- **THEN** stderr holds one line with the trace id, and every exported observation carries that id

#### Scenario: Quiet by default
- **WHEN** a traced run does not use `--verbose`
- **THEN** stderr does not hold the trace id

### Requirement: Context to OpenRouter
Every request the CLI sends to OpenRouter in a traced run SHALL carry a W3C `traceparent` header whose trace id is the run's and whose parent id is the observation that makes the request. An untraced run SHALL send no `traceparent`.

#### Scenario: Header on a generation
- **WHEN** a traced run sends a chat request
- **THEN** its `traceparent` holds the trace id of the run and the span id of that request's `generation`

#### Scenario: Header on a tool request
- **WHEN** a tool call fetches the model catalog
- **THEN** its `traceparent` holds the span id of that call's `tool` observation

#### Scenario: Untraced
- **WHEN** the run is untraced
- **THEN** no request carries `traceparent`

### Requirement: Flush before exit
Before the process exits, a traced run SHALL send every buffered observation to Langfuse, waiting at most 10 s. This holds when the run succeeds, fails, is interrupted by SIGINT or SIGTERM, or ends in a usage error after the root observation opened.

#### Scenario: Success
- **WHEN** a traced run answers
- **THEN** the exporter has received the whole tree before the exit code is set

#### Scenario: Failed run
- **WHEN** the API fails with 500 after a round
- **THEN** the trace, with its error level, was delivered and the exit code is 2

#### Scenario: Interrupt
- **WHEN** SIGINT arrives while a stream is open
- **THEN** the open observations end with an error level and are delivered, nothing more is recorded, and the process exits with 130 for `SIGINT` and 143 for `SIGTERM`

### Requirement: Flush failure
When the final flush fails or times out, the CLI SHALL write one stderr line saying the trace may be incomplete. It SHALL exit 2 if the run would have exited 0. It SHALL keep a non-zero exit code the run already had.

#### Scenario: Flush fails after success
- **WHEN** the answer was written and Langfuse refuses the export
- **THEN** stdout holds the answer, stderr holds one line about the lost trace, and the exit code is 2

#### Scenario: Flush fails after a failure
- **WHEN** the run exited 3 and the flush also fails
- **THEN** stderr holds both lines and the exit code is 3

### Requirement: Keys stay out
The CLI SHALL NOT write any API key to stdout, stderr or Langfuse, including in error messages about Langfuse.

#### Scenario: Error line
- **WHEN** Langfuse rejects keys `pk-lf-AAA` and `sk-lf-BBB`
- **THEN** neither string appears on stdout or stderr
