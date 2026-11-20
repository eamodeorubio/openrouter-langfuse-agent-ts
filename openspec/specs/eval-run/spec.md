# eval-run Specification

## Purpose
Defines how an eval run executes the built CLI against real services and what it records, so that repeated runs of one case are comparable.

## Requirements

### Requirement: The target
A run SHALL evaluate one CLI: the local build by default, or a published version when `--cli-version <x.y.z>` is given. The version SHALL be an exact version from 1.1.0, the first that lists tool calls in `--json`, and any other text SHALL be refused before any request. A published version SHALL start through `pnpm dlx ask-openrouter@<version>` with no shell. The results SHALL name the target in a file beside them, and the report SHALL start with a line that names it.

#### Scenario: A published version
- **WHEN** the script runs with `--cli-version 1.1.0`
- **THEN** each run starts `ask-openrouter@1.1.0` through `pnpm dlx`, and the report names that version

#### Scenario: Refused versions
- **WHEN** the version is `1.0.1`, `latest`, `^1.1.0` or `1.1.0; rm -rf /`
- **THEN** the script exits non-zero with a message that names the rule, and no request is sent

#### Scenario: The local build
- **WHEN** no `--cli-version` is given
- **THEN** the run uses `packages/cli/dist/index.js` and the report names it as the local build

### Requirement: A published version is fetched first
A run against a published version SHALL start that version once, before any case and before the catalog is fetched, with `pnpm dlx ask-openrouter@<version> --version`, so that its download is not part of the latency of any case. A run whose warm-up fails, or answers another version, SHALL stop with a message that names the version, and no request SHALL be sent. The instructions of that version SHALL be read from the package that `pnpm dlx` installed.

#### Scenario: Warm-up fails
- **WHEN** `pnpm dlx` cannot install the version
- **THEN** the script exits non-zero with a message that names the version, and no request is sent

#### Scenario: Another version answers
- **WHEN** the warm-up prints `1.1.1` for `--cli-version 1.1.0`
- **THEN** the script exits non-zero with a message that names both versions

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

### Requirement: Placeholders in a question
The provider SHALL replace `{flagship_model}` and `{free_model}` in the prompt with the slugs that the snapshot of the run picks (`flagshipModel` and `freeModel` of the oracle), and `{fake_key}` with a key generated for the call, everywhere they occur, before it starts the CLI. The key SHALL be `sk-or-v1-` and 64 hexadecimal characters, and a new one for each call. A prompt with `{fake_key}` alone SHALL need no snapshot. A `{name}` that is not one of them SHALL stay as written. A prompt with a placeholder and no snapshot, and a snapshot with no free model besides the models under test, SHALL end the run as a provider error that says so. The runner SHALL tell the provider which models are under test.

#### Scenario: Resolved
- **WHEN** the prompt is "Can I afford {flagship_model}?" and the flagship of the snapshot is `b/y`
- **THEN** the CLI is asked "Can I afford b/y?"

#### Scenario: Left alone
- **WHEN** the prompt holds `{other}`
- **THEN** the CLI receives `{other}` unchanged

#### Scenario: No snapshot
- **WHEN** the prompt holds `{free_model}` and the run has no snapshot
- **THEN** the call ends with an error that names the snapshot

### Requirement: The instructions of the CLI under test
A run SHALL write the instructions of the CLI under test, the `INSTRUCTIONS` export of the `instructions.js` that sits beside its entry, as `instructions.txt` beside the results, and SHALL tell the checks where the file is. A CLI with no readable instructions SHALL stop the run, before any request, with a message that names the file it looked for.

#### Scenario: Written
- **WHEN** a run starts against a CLI whose instructions are "Be brief."
- **THEN** `instructions.txt` beside the results holds "Be brief."

#### Scenario: Missing
- **WHEN** the CLI has no `instructions.js` beside its entry
- **THEN** the run stops with a message that names that file, and no request is made

### Requirement: Results location
A run SHALL write its results as JSON under a results directory that git ignores. The CLI's stderr diagnostics SHALL NOT reach the results as output.

#### Scenario: Ignored directory
- **WHEN** a run completes
- **THEN** `git status` lists no file the run wrote

### Requirement: Choosing the models of a run
A run SHALL ask every model of `vars.model` in the config, unless `--model <id[,id...]>` is given. With it, the run SHALL ask only the listed models, each once, in the order of the config. Every id SHALL be a model of that list, matched exactly. The flag SHALL narrow the matrix and never add to it.

#### Scenario: No flag
- **WHEN** the script runs without `--model`
- **THEN** the run asks the two models of the config, as before

#### Scenario: One model
- **WHEN** the script runs with `--model anthropic/claude-haiku-5.5`
- **THEN** every case is asked of that model only, and the report holds one block, for it

#### Scenario: Several models
- **WHEN** the script runs with `--model anthropic/claude-haiku-5.5,nvidia/nemotron-3-ultra-550b-a55b:free,anthropic/claude-haiku-5.5`
- **THEN** the run asks the two models of the config once each, in the order of the config

### Requirement: Unknown models are refused
A run whose `--model` holds an id outside the config's list, or an empty id, SHALL stop before any request, including the fetch of the catalog and the start of a published version. It SHALL exit with the setup failure code 3 and a message that names the offending id and lists the models of the config.

#### Scenario: Unknown id
- **WHEN** the script runs with `--model openai/gpt-oss-20b` and the config does not list it
- **THEN** it exits 3, stderr names `openai/gpt-oss-20b` and the two models of the config, and no request is sent

#### Scenario: Near miss
- **WHEN** the id differs from a listed one by case or by a trailing space
- **THEN** the run is refused as an unknown id

#### Scenario: Empty id
- **WHEN** the value is `anthropic/claude-haiku-5.5,` or the empty string
- **THEN** the run is refused and no request is sent

### Requirement: Placeholders avoid the models of the run
The free model that a placeholder picks SHALL differ from every model that the run asks. A run narrowed to one model SHALL NOT treat the models it left out as under test.

#### Scenario: Paid model only
- **WHEN** the run asks `anthropic/claude-haiku-5.5` alone and a case holds `{free_model}`
- **THEN** the question names a free model of the snapshot other than `anthropic/claude-haiku-5.5`, and it may be `nvidia/nemotron-3-ultra-550b-a55b:free`

### Requirement: The target names the models
When `--model` is given, `target.txt` SHALL name the models of the run after the target, and so the first line of the report SHALL. A run without `--model` SHALL write the same `target.txt` as before the flag existed.

#### Scenario: Narrowed run
- **WHEN** a run of the local build asks `anthropic/claude-haiku-5.5` alone
- **THEN** the report starts with `target: local build (packages/cli/dist/index.js), models: anthropic/claude-haiku-5.5`

#### Scenario: Unnarrowed run
- **WHEN** a run has no `--model`
- **THEN** `target.txt` is byte for byte what it was before this change

### Requirement: Re-judging a saved run
`pnpm --filter ask-openrouter-evals run rejudge <results.json>` SHALL judge the runs of a saved results file again with the current deterministic checks. It SHALL make no model call and no request. It SHALL NOT modify the input. It SHALL write `rejudged/results.json` beside the input, and copy `catalog.json` and `instructions.txt` into `rejudged/`, so that the directory is a run directory.

#### Scenario: Unchanged checks
- **WHEN** the file was judged by the checks now in the working tree
- **THEN** the command prints 0 flips, and every row of `rejudged/results.json` has the `success` and `score` of the input row

#### Scenario: Offline
- **WHEN** the command runs under the package's offline setup
- **THEN** it completes, and no request leaves the machine

#### Scenario: Errors
- **WHEN** the condition of a row below occurs
- **THEN** the exit code is the one in the row, stderr holds the message, and `rejudged/` is not written

| Condition | Exit | Message names |
| --- | --- | --- |
| no argument, or more than one | 2 | the usage |
| file missing, unreadable or not a promptfoo results file | 1 | the file |
| `catalog.json` or `instructions.txt` missing beside the file | 1 | the missing file |
| a row's `metadata.id` is not a case of the current config | 1 | the id of the first such row |
| the config holds one case id twice, or cannot be read | 1 | the id, or the file |
| an assertion of the case is not a `javascript` check the command can name | 1 | the case and the metric |
| a check throws | 1 | the case, the model and the repeat |

### Requirement: Each run is judged against its own snapshot
The command SHALL set `EVAL_CATALOG` and `EVAL_INSTRUCTIONS` to the `catalog.json` and `instructions.txt` beside the results. It SHALL match each row to a case of the current config by `metadata.id`, and run on the saved output the `javascript` assertions of `defaultTest`, then those of the case, with the case's current metadata. It SHALL keep the `llm-rubric` results as saved.

#### Scenario: Two directories
- **WHEN** two results files with different snapshots are re-judged in one process
- **THEN** each row is judged against the `catalog.json` beside its own file

#### Scenario: A check that was added or removed
- **WHEN** the current config has a `javascript` metric the saved row lacks, or the saved row has one the config lacks
- **THEN** the row holds the current set of `javascript` metrics, and each difference is a flip with `absent` on the side that lacks it

#### Scenario: Provider error
- **WHEN** a row ended in a provider error
- **THEN** the re-judged row is the saved row, byte for byte in its content, and it has no flip

#### Scenario: Rubrics
- **WHEN** a row holds the rubric `judge-grounding` with score 0.72
- **THEN** the re-judged row holds it with score 0.72, and the rubric has no effect on the verdict

### Requirement: The re-judged file is a results file
The re-judged `results.json` SHALL be readable by the `report` command, unchanged. In each judged row the command SHALL replace the `javascript` components with the new verdicts, and recompute `success`, `failureReason`, `gradingResult.pass`, the scores, the `namedScores` of the `javascript` metrics and the counts of `stats`. A row SHALL pass when every component passes. `rejudged/target.txt` SHALL be the input's `target.txt` with ` (re-judged)` appended, so the report names it.

#### Scenario: Report
- **WHEN** `report rejudged/results.json` runs
- **THEN** it prints the report of the re-judged verdicts, its first line is the target with ` (re-judged)`, and its exit code is 0

#### Scenario: A flip changes the row
- **WHEN** `wrong-answer` failed a row and now passes, and no other component fails
- **THEN** the row has `success: true`, and its pass count in the report is one higher

### Requirement: Flips are printed
The command SHALL print on stdout one line for each check whose verdict differs from the saved one, ordered by case, model and repeat, as `<case> | <model> | repeat <index> | <metric> | <before> → <after>`, with the verdicts `pass`, `fail` or `absent`. It SHALL end with a line that gives the number of flips and the number of rows in the file. It SHALL exit 0 with any number of flips.

#### Scenario: One flip
- **WHEN** `wrong-answer` failed repeat 3 of `search/single-search` on model `a/b`, and passes now
- **THEN** stdout holds `search/single-search | a/b | repeat 3 | wrong-answer | fail → pass`, then `1 flip in <n> rows.`

#### Scenario: No flip
- **WHEN** no verdict differs
- **THEN** stdout holds only the closing line with 0 flips, and the exit code is 0

#### Scenario: Two checks of one metric
- **WHEN** a row has two checks of the metric `invented-data`, the second saved as `fail` and now `pass`, and the first unchanged
- **THEN** the command prints one flip, `invented-data | fail → pass`, for the second check only

#### Scenario: Invariant
- **WHEN** a results file is re-judged twice in succession, the second time on the output of the first
- **THEN** the second run prints 0 flips, and its `results.json` equals the first's
