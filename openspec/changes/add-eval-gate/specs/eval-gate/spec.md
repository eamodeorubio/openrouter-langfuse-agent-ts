# Spec Delta

## Purpose

Turns one eval run of a pull request into a verdict, pass, fail or inconclusive, so that a change that makes the agent answer worse is stopped before merge.

## ADDED Requirements

### Requirement: The gate command
`pnpm --filter ask-openrouter-evals run gate <results.json> [--config <file>]` SHALL judge a promptfoo results file against a gate file, `packages/evals/gate.yaml` by default. It SHALL make no request. It SHALL write its table and verdict to stdout and its errors to stderr.

#### Scenario: Offline
- **WHEN** the command runs under the package's offline setup
- **THEN** it completes, and no request leaves the machine

#### Scenario: Another gate file
- **WHEN** the command runs with `--config test/fixtures/gate.yaml`
- **THEN** it judges by that file and not by `gate.yaml`

### Requirement: The gate file
The gate file SHALL be YAML with exactly these keys, and SHALL be refused, with exit 2 and a message naming the key, when one is missing, has the wrong type, is out of range, or when an unknown key appears.

#### Scenario: Keys
- **WHEN** the gate file is read
- **THEN** each key is checked as below

| Key | Type | Range |
| --- | --- | --- |
| `model` | string | not empty |
| `repeat` | whole number | from 1 |
| `k` | whole number | from 1 to `repeat` |
| `mean` | number | 0 to 1 |
| `cases` | map of case id to number, at least one entry | each value 0 to 1 |

#### Scenario: Unknown key
- **WHEN** the file holds `floors: 0.4` beside the keys above
- **THEN** the command exits 2 and stderr names `floors`

### Requirement: The shipped gate file
`packages/evals/gate.yaml` SHALL hold `model: anthropic/claude-haiku-5.5`, `repeat: 10`, `k: 3` and `mean: 0.85`, and in `cases` one floor for each case of the `core` set: 0.05 for `ambiguity/cheapest-for-chatbot` and 0.4 for every other case. Every id in `cases` SHALL be a case of the `core` set, and every case of the `core` set SHALL have an id in `cases`.

#### Scenario: Content
- **WHEN** the config test loads `gate.yaml`
- **THEN** it holds the values above, and its model is a model of `vars.model` in the config

#### Scenario: Stale case
- **WHEN** an id in `cases` names no case of the `core` set
- **THEN** the config test fails and names the id

#### Scenario: Case without a floor
- **WHEN** a case of the `core` set has no id in `cases`
- **THEN** the config test fails and names the case

### Requirement: The results must match the gate file
The command SHALL refuse, with exit 2 and a message naming the mismatch, a results file that holds a model other than the gate's `model`, a cell whose n differs from `repeat`, or no run at all. It SHALL refuse an id in `cases` that is not a case of the results, and a case of the results with no id in `cases`.

#### Scenario: Mismatches
- **WHEN** the condition of a row below holds
- **THEN** the command exits 2 and stderr names what the row says

| Condition | Message names |
| --- | --- |
| a run of `nvidia/nemotron-3-ultra-550b-a55b:free` | that model and the gate's model |
| `lookup/known-model` has 9 runs and `repeat` is 10 | the case, 9 and 10 |
| an empty results file | the file |
| `cases` holds `search/gone`, and no run has that case | `search/gone` |
| runs of `lookup/new-case`, and `cases` has no `lookup/new-case` | `lookup/new-case` |

### Requirement: Floors
For each case the command SHALL compute pass^k with the k of the gate file, by the estimator of the report. A case SHALL breach when its pass^k is below its floor, its entry in `cases`. The model SHALL breach when the mean of the pass^k of its cases, each with equal weight, is below `mean`. A value equal to its floor SHALL NOT breach.

#### Scenario: Floors at n 10 and k 3
- **WHEN** a case whose floor is 0.4 has the passes below
- **THEN** it breaches as the table says

| c of 10 | pass^3 | Breach |
| --- | --- | --- |
| 10 | 1.0000 | no |
| 8 | 0.4667 | no |
| 7 | 0.2917 | yes |
| 0 | 0.0000 | yes |

#### Scenario: A case of its own
- **WHEN** `ambiguity/cheapest-for-chatbot` passes 5 of 10 and its entry is 0.05
- **THEN** its pass^3 is 0.0833 and it does not breach

#### Scenario: Equal to the floor
- **WHEN** a case's pass^k equals its floor exactly
- **THEN** it does not breach

#### Scenario: Mean
- **WHEN** 11 cases have pass^3 of 1 and one of them drops to 0.4667, so no case breaches, and `mean` is 0.95
- **THEN** the mean is 0.9515 and the model does not breach

### Requirement: The verdict
The verdict SHALL be pass when nothing breaches. When something breaches, the command SHALL count each errored run as passed and compute again. The verdict SHALL be inconclusive when nothing breaches then, and fail otherwise. A provider error SHALL never turn a pass into a fail or an inconclusive.

#### Scenario: Decision
- **WHEN** a run of `repeat: 10` and `k: 3`, with a floor of 0.4 for every case, holds the cells below and every other case passes 10 of 10
- **THEN** the verdict is the one in the row

| Cells | Verdict |
| --- | --- |
| none below its floor, 3 provider errors spread over cases | pass |
| one case 7 of 10, 0 errors | fail |
| one case 7 of 10, 2 of the 3 misses are provider errors | inconclusive |
| one case 7 of 10 with 2 errors, another 7 of 10 with 0 errors | fail |
| every run a provider error | inconclusive |

#### Scenario: Invariant
- **WHEN** any results file is judged
- **THEN** a file judged pass stays pass when any failed run is changed to passed, and a file judged fail stays fail when a passed run is changed to failed

### Requirement: Output and exit code
The command SHALL print one row per case, sorted by case id, then a `mean` row, then one verdict line. A row SHALL hold the case, `c=<c>/<n>`, `err=<errors>`, `pass^<k>=` with four decimals, `floor` with four decimals, and `ok` or `below`. The exit code SHALL follow the verdict.

#### Scenario: Rows
- **WHEN** `search/none-exists` passes 7 of 10 with 1 provider error, k is 3 and its floor 0.4
- **THEN** its row holds `search/none-exists`, `c=7/10`, `err=1`, `pass^3=0.2917`, `floor 0.4000` and `below`

#### Scenario: Verdict lines
- **WHEN** the verdict is the one in the row below
- **THEN** the last line of stdout and the exit code are as given

| Verdict | Last line | Exit |
| --- | --- | --- |
| pass | `verdict: pass` | 0 |
| fail, 2 cases and the mean below | `verdict: fail (2 cases below their floor, mean below its floor)` | 1 |
| fail, 1 case below | `verdict: fail (1 case below its floor)` | 1 |
| inconclusive, 3 provider errors | `verdict: inconclusive (3 provider errors; the breaches clear when they count as passed, run the gate again)` | 4 |

#### Scenario: Unreadable input
- **WHEN** the results file or the gate file is missing, is not valid JSON or YAML, or the arguments are wrong
- **THEN** stderr names the file or shows the usage, stdout is empty and the exit code is 2

### Requirement: Which pull requests the gate concerns
The paths that concern the gate SHALL be the globs of one file, `.github/eval-gate-paths.yml`, and nowhere else. They SHALL cover what can change what an eval run measures: the source, build scripts, build configs and package file of the CLI; the source, cases, rubrics, config, package file and gate file of the evals; the gate workflow and the filter file; and `.nvmrc`. Tests, docs, Stryker configs and `pnpm-lock.yaml` SHALL NOT match.

#### Scenario: Concerned
- **WHEN** a pull request changes `packages/cli/src/instructions.ts`
- **THEN** the gate job runs

#### Scenario: Not concerned
- **WHEN** a pull request changes `README.md` and `packages/cli/test/ask.test.ts` alone
- **THEN** the gate job is skipped

### Requirement: The gate workflow
`.github/workflows/eval-gate.yml` SHALL run on `pull_request` of types `opened`, `synchronize` and `reopened`, and on no other event. A first job, `changes`, SHALL match the changed files against the filter file, with no environment and no secret. A second job, `eval gate`, SHALL need it and run only when a file matched. A newer run for the same pull request SHALL cancel the one in progress.

#### Scenario: Triggers
- **WHEN** the workflow test loads the file
- **THEN** `on` holds `pull_request` with those three types alone, and no `pull_request_target`

#### Scenario: Concurrency
- **WHEN** the workflow test loads the file
- **THEN** its concurrency group names the pull request number and `cancel-in-progress` is true

#### Scenario: The filter job
- **WHEN** the workflow test loads the file
- **THEN** the job `changes` names no environment and no secret, and the job `eval gate` holds `needs: changes` and an `if:` on its output

### Requirement: The gated run
When the job `eval gate` runs and the key is present, it SHALL build the CLI, run `eval --set core --model <gate model> --repeat 10 --k 3 --skip-weightless-rubrics`, then `gate` on the results, and SHALL fail when `gate` exits non-zero or the run does not finish.

#### Scenario: Gated
- **WHEN** a pull request changes `packages/cli/src/instructions.ts`
- **THEN** the job runs the eval and the gate, and its status is that of the gate

### Requirement: The key of the gate
The job SHALL read `OPENROUTER_API_KEY` from the secrets of the GitHub environment `eval-gate`, and pass it only to the step that runs the eval, through `env:`. When the key is empty, as for a fork or Dependabot, the job SHALL send no request, pass, and say in its summary and in a warning annotation that the gate did not run for want of a key.

#### Scenario: Key scope
- **WHEN** the workflow test loads the file
- **THEN** the job names the environment `eval-gate`, `${{ secrets.OPENROUTER_API_KEY }}` appears in the `env:` of the eval step alone, and any other mention of the secret is the comparison `secrets.OPENROUTER_API_KEY != ''`

#### Scenario: No key
- **WHEN** a pull request from a fork changes `packages/cli/src/instructions.ts`
- **THEN** the job passes without a request, and its summary says the gate did not run for want of a key

### Requirement: What the job leaves
Whatever the outcome, the job SHALL write a summary holding the commit, the gate's table and verdict when they exist, and the report of the run, and SHALL keep the run's folder, with the gate's output, as an artifact for 90 days.

#### Scenario: Failed gate
- **WHEN** the gate exits 1
- **THEN** the summary holds the gate's rows and verdict line, and the artifact holds `results.json` and the gate's output
