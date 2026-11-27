# Spec Delta

## MODIFIED Requirements

### Requirement: Evals stay out of the offline suite
The root `pnpm test` and the `CI` workflow SHALL NOT start an eval run or send a request to a real service. An eval run SHALL start only from the package's `eval` scripts: by hand, from the Evals workflow, or from the gate workflow on a pull request that the gate concerns. The package's own unit tests SHALL run offline.

#### Scenario: Plain test run
- **WHEN** `pnpm test` runs at the repository root
- **THEN** only offline unit tests run and no request leaves the machine

#### Scenario: Unmocked request in a unit test
- **WHEN** a unit test of the package requests a host other than the loopback interface
- **THEN** the request is refused and the test fails

#### Scenario: The CI workflow
- **WHEN** the workflow test loads `.github/workflows/ci.yml`
- **THEN** no step runs the `eval` script or reads `OPENROUTER_API_KEY`

## ADDED Requirements

### Requirement: Skipping the rubrics of weight 0
With `--skip-weightless-rubrics`, a run SHALL remove, before its first request, every `llm-rubric` assertion whose weight is 0, from every case and from `defaultTest`. Assertions of other types, and rubrics with a weight above 0 or with no weight, SHALL stay. Without the flag, the run SHALL keep every assertion.

#### Scenario: Effect
- **WHEN** a run of the fake provider, against the loopback Jev server, matches the row below
- **THEN** the server receives the requests, and the report holds the judge lines, that the row gives

| Run | Requests to Jev | Judge lines in the report |
| --- | --- | --- |
| no flag, every rubric at weight 0 | one per rubric of each run | one per rubric |
| flag, every rubric at weight 0 | none | none |
| flag, `judge-relevance` at weight 1, the others at 0 | one per run that lists `judge-relevance` | `judge-relevance` only |
| flag, a rubric with no `weight` key | one per run that lists it | that rubric only |

#### Scenario: Verdicts unchanged
- **WHEN** the same answers are judged with and without the flag, every rubric at weight 0
- **THEN** each run passes or fails the same way, and the report shows the same n, c and errors for every cell

#### Scenario: Other assertions
- **WHEN** a case holds `javascript` checks and rubrics of weight 0, and the flag is given
- **THEN** every `javascript` check of the case and of `defaultTest` still runs, in the same order

#### Scenario: The flag is reported
- **WHEN** a run has the flag
- **THEN** `target.txt` ends with `, rubrics of weight 0 skipped`, and so does the first line of the report; a run without the flag writes `target.txt` as before
