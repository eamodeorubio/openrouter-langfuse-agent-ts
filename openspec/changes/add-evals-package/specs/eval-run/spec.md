# Spec Delta

## Purpose

Defines how an eval run executes the built CLI against real services and what it records, so that repeated runs of one case are comparable.

## ADDED Requirements

### Requirement: The target
A run SHALL evaluate one CLI: the local build by default, or a published version when `--cli-version <x.y.z>` is given. The version SHALL be an exact version from 1.1.0, the first that lists tool calls in `--json`, and any other text SHALL be refused before any request. A published version SHALL start through `pnpm dlx ask-openrouter@<version>` with no shell. The results SHALL name the target, and the report SHALL show it.

#### Scenario: A published version
- **WHEN** the script runs with `--cli-version 1.1.0`
- **THEN** each run starts `ask-openrouter@1.1.0` through `pnpm dlx`, and the report names that version

#### Scenario: Refused versions
- **WHEN** the version is `1.0.1`, `latest`, `^1.1.0` or `1.1.0; rm -rf /`
- **THEN** the script exits non-zero with a message that names the rule, and no request is sent

#### Scenario: The local build
- **WHEN** no `--cli-version` is given
- **THEN** the run uses `packages/cli/dist/index.js` and the report names it as the local build

### Requirement: Evals stay out of the offline suite
The root `pnpm test` and CI SHALL NOT start an eval run or send a request to a real service. An eval run SHALL start only from the package's `eval` scripts. The package's own unit tests SHALL run offline.

#### Scenario: Plain test run
- **WHEN** `pnpm test` runs at the repository root
- **THEN** only offline unit tests run and no request leaves the machine

#### Scenario: Unmocked request in a unit test
- **WHEN** a unit test of the package requests a host other than the loopback interface
- **THEN** the request is refused and the test fails

### Requirement: The provider runs the built CLI
The provider SHALL start `dist/index.js` of the CLI package with `--json`, `--model <vars.model>` and `-q <question>`, without a shell. It SHALL return the success object the CLI wrote to stdout as the run's output.

#### Scenario: Successful run
- **WHEN** a case has `vars.model` `a/b` and the question `Q`
- **THEN** the CLI is started with `--json --model a/b -q Q` and the provider returns the JSON object from stdout

#### Scenario: Question with shell syntax
- **WHEN** the question holds quotes, `$(id)`, a semicolon and a newline
- **THEN** the CLI receives the question unchanged and no command runs

### Requirement: The model comes from the case
The provider SHALL fail with an error naming `vars.model` when that var is missing or empty. It SHALL NOT read `OPENROUTER_MODEL`.

#### Scenario: Missing var
- **WHEN** a case has no `vars.model`
- **THEN** the run is a provider error that names `vars.model` and the CLI is not started

#### Scenario: Environment model set
- **WHEN** a case has no `vars.model` and `OPENROUTER_MODEL` is set
- **THEN** the run is the same provider error

### Requirement: The build must exist
When `dist/index.js` is missing the eval run SHALL stop before any request, exit non-zero and tell the user to build the CLI.

#### Scenario: No build
- **WHEN** an eval run starts and `packages/cli/dist/index.js` does not exist
- **THEN** stderr says to run the build, the exit code is non-zero and no request is sent

### Requirement: Outcomes of a CLI run
The provider SHALL map the CLI's outcome as follows.

| CLI outcome | Provider result |
| --- | --- |
| exit 0, stdout is a JSON object with `success: true` | output is that object |
| exit 0, stdout is anything else | provider error naming the unreadable output |
| exit non-zero | provider error holding the exit code and the stderr text |
| no exit within the timeout | process killed, provider error naming the timeout |

#### Scenario: Failing CLI
- **WHEN** the CLI exits 1 and writes a failure JSON to stderr
- **THEN** the run is a provider error that holds exit code 1 and that stderr text

### Requirement: Cost and tokens
The provider SHALL report the CLI's `usage.cost` as the run's cost, and its prompt and completion tokens as the run's token usage. When `usage.cost` is absent the run SHALL have no cost, never 0.

#### Scenario: Cost reported
- **WHEN** `usage.cost` is 0.0123 and `usage.totalTokens` is 900
- **THEN** the run's cost is 0.0123 and its total tokens are 900

#### Scenario: Cost absent
- **WHEN** the success object has no `usage.cost`
- **THEN** the run has no cost value

### Requirement: The model matrix
The config SHALL list exactly two models in `vars.model`: `nvidia/nemotron-3-ultra-550b-a55b:free` and `anthropic/claude-haiku-5.5`. A slug SHALL NOT be an alias such as `latest` or begin with `~`.

#### Scenario: Matrix content
- **WHEN** the config is loaded
- **THEN** it holds two distinct slugs, the two slugs above

#### Scenario: Alias
- **WHEN** a slug contains `latest` or begins with `~`
- **THEN** the config test fails

### Requirement: Repeats without cache
The `eval` scripts SHALL run each case 10 times per model and SHALL disable the cache, so that every repeat is a new request.

#### Scenario: Script flags
- **WHEN** the `eval` script runs without options
- **THEN** it runs promptfoo with `--repeat 10` and `--no-cache`

### Requirement: Failed runs do not stop the report
The `eval` scripts SHALL run the reporter after promptfoo ends, also when runs failed or errored. A promptfoo exit for any other cause SHALL stop the script with that exit code and no report.

#### Scenario: Failing runs
- **WHEN** some runs fail a check or end in a provider error
- **THEN** the report prints and the script exits 0

#### Scenario: Broken config
- **WHEN** promptfoo exits because its config is invalid
- **THEN** no report prints and the script exits non-zero

### Requirement: The k list fits the repeats
The `eval` scripts SHALL refuse a `--k` list whose widest k is above `--repeat`, and a `--k` that is not a list of whole numbers from 1, before any request. The default k list is 1, 3 and 5.

#### Scenario: Repeats too few
- **WHEN** the script runs with `--repeat 3` and no `--k`
- **THEN** it exits non-zero with a message that names the widest k and the repeats, and no promptfoo run starts

#### Scenario: Repeats enough
- **WHEN** the script runs with `--repeat 3 --k 1,3`
- **THEN** the run starts

### Requirement: The key stays in the environment
The key SHALL come from `OPENROUTER_API_KEY` in the environment. No file the run writes SHALL hold its value, and no config file SHALL hold a literal key.

#### Scenario: Dummy key
- **WHEN** a run completes with `OPENROUTER_API_KEY` set to a dummy value
- **THEN** no file under the results directory contains that value

### Requirement: Results location
A run SHALL write its results as JSON under a results directory that git ignores. The CLI's stderr diagnostics SHALL NOT reach the results as output.

#### Scenario: Ignored directory
- **WHEN** a run completes
- **THEN** `git status` lists no file the run wrote
