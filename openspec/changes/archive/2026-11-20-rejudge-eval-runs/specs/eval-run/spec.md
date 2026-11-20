## ADDED Requirements

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
