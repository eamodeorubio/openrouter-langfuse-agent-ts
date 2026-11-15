# eval-report Specification

## Purpose
Defines the report that turns a run's results into pass@k and pass^k per model and case, with the cost, speed and judge figures beside them.

## Requirements

### Requirement: Input and output
The reporter SHALL read the results file named by its argument and write the report to stdout. A missing, unreadable or malformed file SHALL give a message on stderr and a non-zero exit. A well-formed file SHALL give exit 0, whatever its figures.

#### Scenario: Missing file
- **WHEN** the argument names a file that does not exist
- **THEN** stderr says the file is missing, stdout is empty and the exit code is non-zero

#### Scenario: Failing cases
- **WHEN** every run in the file failed
- **THEN** the report prints and the exit code is 0

### Requirement: Cells
A cell SHALL be one case on one model. The case is named by its `metadata.id`, else by its `description`, else by its question. Its n is the number of runs, and its c the number that passed. A run that ended in a provider error SHALL count as not passed, and each cell SHALL show its error count.

#### Scenario: Errors
- **WHEN** a cell has 10 runs, 6 passed, 3 failed a check and 1 was a provider error
- **THEN** the cell shows n 10, c 6 and 1 error

### Requirement: Estimators
For each k in 1, 3 and 5, or in the list given with `--k`, the report SHALL print, per cell, pass@k = 1 − C(n−c, k) / C(n, k) and pass^k = C(c, k) / C(n, k). A k above n, or a c above n, SHALL be an error.

| n | c | k | pass@k | pass^k |
| --- | --- | --- | --- | --- |
| 10 | 7 | 3 | 0.9917 | 0.2917 |
| 10 | 7 | 5 | 1.0000 | 0.0833 |
| 10 | 4 | 5 | 0.9762 | 0.0000 |
| 10 | 0 | 3 | 0.0000 | 0.0000 |
| 10 | 10 | 3 | 1.0000 | 1.0000 |
| 10 | 6 | 1 | 0.6000 | 0.6000 |

#### Scenario: Worked cell
- **WHEN** a cell has n 10 and c 7
- **THEN** it shows pass@3 0.9917 and pass^3 0.2917

#### Scenario: k above n
- **WHEN** a cell has n 4 and k is 5
- **THEN** the reporter exits non-zero with a message that names n and k

### Requirement: Estimator invariants
For every valid n, c and k the estimators SHALL lie in [0, 1], pass^k SHALL not exceed c/n, and pass@k SHALL not be below c/n. pass@k SHALL not fall as k rises, and pass^k SHALL not rise.

#### Scenario: Monotone in k
- **WHEN** n is 10 and c is 7
- **THEN** pass@1 ≤ pass@3 ≤ pass@5 and pass^1 ≥ pass^3 ≥ pass^5

### Requirement: Model rows
For each model the report SHALL add a row holding the mean of each estimator over its cells. Cells SHALL carry equal weight.

#### Scenario: Mean of cells
- **WHEN** a model has cells with pass^3 of 0.2 and 0.6
- **THEN** its row shows pass^3 0.4

### Requirement: Failures by class
Each cell SHALL show how many of its runs carried each class, read from the metric names of the failed checks.

#### Scenario: Two classes
- **WHEN** 2 runs failed `memory-answer` and 1 failed `wrong-value`
- **THEN** the cell shows `memory-answer` 2 and `wrong-value` 1

### Requirement: Results by error class
After the cells of a model the report SHALL show, for each error class, how many runs the class judged, how many passed it and how many failed it. A class judges a run when a check of that class ran on it. A run that an earlier class of the chain failed is not judged by a later one. A provider error is a failed run of `run-failed` and is judged by no other class.

#### Scenario: Counts of a class
- **WHEN** 10 runs of a case ran the check `wrong-value`, 8 passed it and 2 failed it
- **THEN** the class shows judged 10, passed 8 and failed 2

#### Scenario: A later class is not judged after an earlier one
- **WHEN** 3 of 10 runs carry `memory-answer`
- **THEN** `invented-data` judges the other 7 runs at most

#### Scenario: Provider errors
- **WHEN** 2 of 10 runs end in a provider error
- **THEN** `run-failed` judges 10 runs and fails 2, and every other class judges at most 8

### Requirement: Estimators by error class
Each class of the report SHALL show pass@k and pass^k. They are the mean, over the cases that have the class, of the estimators of the judged runs of each case. A case whose judged runs are fewer than k SHALL be left out of that k, and a class with no such case SHALL show `-`.

#### Scenario: Estimators of a class
- **WHEN** a class has one case with 10 judged runs of which 7 passed
- **THEN** its pass@3 is 0.9917 and its pass^3 is 0.2917

#### Scenario: Too few judged runs
- **WHEN** the only case of a class has 4 judged runs and k is 5
- **THEN** the class shows `-` for the estimators of 5

### Requirement: Informational figures
Each cell and model row SHALL show mean cost, mean latency, mean tool rounds and cost per solved task. These figures SHALL NOT affect the exit code.

#### Scenario: Mean cost
- **WHEN** 6 of 10 runs reported a cost
- **THEN** the mean covers those 6 runs and the cell says 6, and it reads `n/a` when none reported one

#### Scenario: Errored run
- **WHEN** a run ended in a provider error and its record holds a cost of 0
- **THEN** that run reported no cost and is left out of the mean

#### Scenario: Tool rounds
- **WHEN** a run's calls have the rounds 1, 1 and 2, and another run made no call
- **THEN** their tool rounds are 2 and 0

#### Scenario: Errored run in the tool rounds
- **WHEN** a run ended in a provider error
- **THEN** it has no tool rounds and is left out of the mean

#### Scenario: Cost per solved task
- **WHEN** a cell's reported costs sum to 0.50 and 4 runs passed
- **THEN** cost per solved task is 0.125

#### Scenario: No cost reported
- **WHEN** no run of a cell reported a cost
- **THEN** mean cost and cost per solved task read `n/a` and `-`, not 0

### Requirement: Wall time
When the results file holds the duration of the eval, the report SHALL end with one line that says it in seconds, with the number of runs and the concurrency when known. It SHALL print no such line when the file holds no duration.

#### Scenario: Wall time line
- **WHEN** the file says the eval took 30815 ms, with 30 runs at a concurrency of 4
- **THEN** the last line is `wall time 30.8 s for 30 runs (concurrency 4)`

#### Scenario: No duration
- **WHEN** the file holds no duration
- **THEN** the report has no wall time line

### Requirement: Judge pass rate
Each cell SHALL show, per rubric, the share of its scored runs at or above the rubric's own threshold, as the saved results state it for that rubric, and how many runs had no score. The rate SHALL NOT enter the pass estimators while the rubric has weight 0.

#### Scenario: Unscored runs
- **WHEN** 8 runs scored and 2 had a state over the limit, and 6 of the 8 reached 0.5
- **THEN** the cell shows 0.75 and 2 unscored
