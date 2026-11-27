# Spec Delta

## ADDED Requirements

### Requirement: Highest benchmark score
The query `top-index` SHALL take `index`, the API's name of an Artificial Analysis score, and return every model whose score is within 1% of the highest. A model without that score is excluded. A missing or non-text `index` SHALL fail with an error that says what to send.

#### Scenario: Ranking
- **WHEN** `index` is `legal_index` and the models score `t/a` 60, `t/b` 59.5, `t/c` 40, and `t/d` has none
- **THEN** the result is `t/a` and `t/b`

#### Scenario: No score
- **WHEN** no model of the snapshot has the score
- **THEN** the result is empty

#### Scenario: No index
- **WHEN** the case gives no `index`
- **THEN** the query fails and names `index`

## MODIFIED Requirements

### Requirement: Snapshot before the first run
An eval run SHALL fetch OpenRouter's public model list once, before the first case starts, and SHALL save it, with the time it was fetched, as `catalog.json` beside the run's results. Prices in the snapshot are in USD per million tokens, and a price the API gives as negative or as text that is not a number is `null`. A model also keeps its input and output modalities, and each Artificial Analysis score the API gives as a number, under the API's name. A snapshot saved without scores SHALL still load. When the fetch fails the run SHALL stop before any case, exit non-zero and say why.

#### Scenario: Snapshot taken
- **WHEN** an eval run starts and the model list is reachable
- **THEN** a snapshot file with the model list and a fetch time exists before the first CLI start

#### Scenario: Fetch fails
- **WHEN** the model list request fails
- **THEN** no case runs, stderr names the failure and the exit code is non-zero

#### Scenario: Scores kept
- **WHEN** the API gives a model `legal_index: 41.2` and `cyber_index: null`
- **THEN** the snapshot keeps `legal_index` for the model and no `cyber_index`

#### Scenario: Older snapshot
- **WHEN** a saved snapshot holds no scores
- **THEN** it loads, and its models have none
