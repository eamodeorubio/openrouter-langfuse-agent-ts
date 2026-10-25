# Spec Delta

## Purpose

Lets a user learn every flag, setting and exit code, and the installed version, from the terminal alone. Shows the help when the arguments are wrong.

## ADDED Requirements

### Requirement: Help flag
The CLI SHALL accept `--help` and `-h`. Either SHALL print the help text to stdout, write nothing to stderr, exit 0, and send no request. Help SHALL win over every other argument, valid or not, and over `--json`.

#### Scenario: Long and short flag
- **WHEN** the CLI runs with `--help`, or with `-h`
- **THEN** stdout holds the help text, stderr is empty, the exit code is 0, and no request is sent

#### Scenario: Help beats other arguments
- **WHEN** the CLI runs with `-q "hi" --json --help`, or with `--bogus --help`
- **THEN** stdout holds the help text as plain text, and the exit code is 0

#### Scenario: No configuration needed
- **WHEN** the CLI runs with `--help` and neither `OPENROUTER_API_KEY` nor `.env` exists
- **THEN** stdout holds the help text and the exit code is 0

### Requirement: Help content
The help text SHALL hold, in this order: a title line with the command name and the version, such as `ask-openrouter 1.0.0`; a usage line; every flag with a one-line description; every environment variable the tool reads; how `.env` is read; the exit codes; examples; the address of the documentation.

#### Scenario: Required parts

| Part | Content |
| --- | --- |
| Title | `<name> <version>`, the version from `package.json`; the name alone when the version cannot be read |
| Flags | `-q`, `--model`, `--thinking`, `--no-thinking`, `--verbose`, `--json`, `-v`, `--version`, `-h`, `--help` |
| Variables | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, `NO_COLOR` |
| `.env` | read from the current directory; the environment wins |
| Exit codes | 0, 1, 2, 3, with their meanings |
| Examples | a question with `-q`, a question on stdin, `--json` |

#### Scenario: Every flag is described
- **WHEN** the help text is printed
- **THEN** each flag the parser accepts appears in it, with a description

#### Scenario: Version in the title
- **WHEN** the help text is printed and the package version is `1.0.0`
- **THEN** its first line is `ask-openrouter 1.0.0`, whether it was asked for with `--help` or printed after a usage error

#### Scenario: Every variable is named
- **WHEN** the help text is printed
- **THEN** each variable in the table appears in it

### Requirement: Help after a usage error
A usage error SHALL print its message to stderr, a blank line, and the help text, and exit 1. A usage error is an unknown flag, an unexpected positional argument, a flag without its value, a missing question, or `--thinking` with `--no-thinking`. Stdout SHALL stay empty. Under `--json` the failure SHALL be the JSON object alone, without the help text.

#### Scenario: Unknown flag
- **WHEN** the CLI runs with `--bogus`
- **THEN** stderr holds a message naming `--bogus`, a blank line and the help text, stdout is empty, and the exit code is 1

#### Scenario: Missing question
- **WHEN** the CLI runs with no `-q` and an empty stdin
- **THEN** stderr ends with the help text, and the exit code is 1

#### Scenario: Unknown flag under JSON
- **WHEN** the CLI runs with `--json --bogus`
- **THEN** stderr holds one JSON object with the code `USAGE_ERROR` and no help text, and the exit code is 1

### Requirement: Version flag
The CLI SHALL accept `--version` and `-v`. Either SHALL print the version from `package.json`, alone on one line, to stdout, write nothing to stderr, exit 0, and send no request. It SHALL need no configuration and SHALL win over every other argument and over `--json`, except `--help`, which wins over it. An unreadable `package.json` SHALL give one line on stderr and exit 2.

#### Scenario: Long and short flag
- **WHEN** the CLI runs with `--version`, or with `-v`, and the package version is `1.0.0`
- **THEN** stdout is `1.0.0` and a newline, stderr is empty, and the exit code is 0

#### Scenario: Version beats other arguments
- **WHEN** the CLI runs with `-q "hi" --json --version`, or with `--bogus --version`
- **THEN** stdout is the version as plain text, and the exit code is 0

#### Scenario: Help beats version
- **WHEN** the CLI runs with `--version --help`
- **THEN** stdout holds the help text, whose first line carries the version, and not the bare version line, and the exit code is 0

#### Scenario: Manifest unreadable
- **WHEN** the CLI runs with `--version` and `package.json` cannot be read
- **THEN** stderr holds one line saying so, stdout is empty, and the exit code is 2

### Requirement: Help text is not a result
The help text SHALL NOT mention a secret, and SHALL NOT change with the environment. Two runs with different variables, from the same install, print the same text.

#### Scenario: Same text everywhere
- **WHEN** `--help` runs with `OPENROUTER_API_KEY=sk-test` set, and again with no variables
- **THEN** the two outputs are identical and neither holds `sk-test`
