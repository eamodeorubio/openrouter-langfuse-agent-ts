# eval-oracle Specification

## Purpose
Defines the catalog snapshot an eval run takes before its first case, the named queries that turn it into expected answers, and the variables cases draw from it.

## Requirements

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

### Requirement: Named queries
Expected answers SHALL come from named queries over the snapshot. A case SHALL name its query and its parameters. An unknown name SHALL fail with an error that lists the known names.

#### Scenario: Unknown query
- **WHEN** a case names the query `cheapest-bogus`
- **THEN** the check fails with an error that lists the known query names

### Requirement: Cheapest blended price
The query `cheapest-blended` SHALL take `minContext`, `supportedParameters` and `mix`, the input tokens per output token, default 3. It SHALL return every paid model that meets all constraints and whose blended price is within 1% of the lowest.

#### Scenario: Definitions
- **WHEN** the query ranks models
- **THEN** the blended price is (`mix` × input price + output price) / (`mix` + 1), a model is paid when its blended price is above 0, and a model with a `null` price is excluded

#### Scenario: Worked table
- **WHEN** the query runs on this table with `minContext` 200000, `supportedParameters` `["tools"]` and `mix` 3
- **THEN** the result is `t/g` and `t/h`

| Slug | Context | Tools | Input | Output | Blended |
| --- | --- | --- | --- | --- | --- |
| `t/a` | 262144 | yes | 1.0 | 4.0 | 1.75 |
| `t/b` | 200000 | yes | 2.0 | 0.4 | 1.60 |
| `t/c` | 128000 | yes | 0.1 | 0.1 | 0.10 |
| `t/d` | 300000 | yes | 0 | 0 | 0 |
| `t/e` | 300000 | no | 0.01 | 0.01 | 0.01 |
| `t/f` | 300000 | yes | `null` | `null` | none |
| `t/g` | 200000 | yes | 1.0 | 2.4 | 1.35 |
| `t/h` | 250000 | yes | 0.9 | 2.7 | 1.35 |

#### Scenario: No match
- **WHEN** `minContext` is 1000000 on the same table
- **THEN** the result is empty

### Requirement: Cheapest by input price
The query `cheapest-input` SHALL take `minContext`, `supportedParameters`, `inputModalities` and `outputModalities`, each optional. It SHALL return every model with an input price above 0 that meets all constraints and whose input price is within 1% of the lowest.

#### Scenario: Image input
- **WHEN** `inputModalities` is `["image"]`
- **THEN** only models that accept image input qualify, and the result is the cheapest of them and its ties

### Requirement: Matching models
The query `matching` SHALL take `minContext`, `supportedParameters`, `inputModalities`, `outputModalities` and `maxInputPrice`, each optional, and return every model that meets all of them. A model meets `maxInputPrice` when its input price is known and below it.

#### Scenario: None
- **WHEN** no model has 2,000,000 tokens of context, image output and an input price under 0.01
- **THEN** the result is empty

#### Scenario: A count
- **WHEN** the query runs with `minContext` 1,000,000 and `supportedParameters` `["tools"]`
- **THEN** the number of slugs in the result is the count of such models

### Requirement: Models within a budget
The query `within-budget` SHALL take a workload (`chatsPerDay`, `inputTokens`, `outputTokens`, `days`), a `budget` in USD and optional `supportedParameters`. It SHALL return every model with known prices and those parameters whose monthly cost is at most the budget, which is chats × days × (input tokens × input price + output tokens × output price) / 1,000,000.

#### Scenario: Cost of the chatbot
- **WHEN** the workload is 2,000 chats a day of 1,500 and 400 tokens for 30 days and a model costs 1.0 and 4.0 USD per million tokens
- **THEN** its monthly cost is 186 USD

### Requirement: Query invariants
Every query SHALL return a subset of the snapshot, SHALL NOT depend on the order of the snapshot, SHALL return only models that meet every constraint it was given, and SHALL NOT throw on an empty snapshot.

#### Scenario: Tighter constraint
- **WHEN** `minContext` rises from 200000 to 250000 on the table of `cheapest-blended`
- **THEN** no model with less than 250000 tokens of context is in the result

#### Scenario: A dearer winner
- **WHEN** the cheapest model drops out because a constraint tightens
- **THEN** the models that now qualify, and the dearer one among them, make the result

#### Scenario: Empty snapshot
- **WHEN** a query runs on an empty snapshot
- **THEN** it returns an empty result

### Requirement: A flagship model for a case
The variable `flagshipModel` SHALL be the slug of the paid model with the highest sum of input and output prices in the snapshot, the lowest slug in order when two tie. Every repeat of every case SHALL receive the same value in one run.

#### Scenario: Pick
- **WHEN** the snapshot holds paid models with price sums 4, 210 and 210, in ids `a/x`, `b/y` and `c/z`
- **THEN** `flagshipModel` is `b/y`

### Requirement: A free model for a case
The variable `freeModel` SHALL be the first slug, in ascending order, of a free model in the snapshot that is not one of the models under test. A model is free when its input and output prices are 0. Every repeat of every case SHALL receive the same value in one run. When the snapshot has no such model the run SHALL fail with an error that says so.

#### Scenario: Pick
- **WHEN** the snapshot holds free models `z/y:free`, `a/b:free` and `nvidia/nemotron-3-ultra-550b-a55b:free`
- **THEN** `freeModel` is `a/b:free`

#### Scenario: Only models under test
- **WHEN** the only free models in the snapshot are the models under test
- **THEN** the run fails with an error that says no free model is available

#### Scenario: Stability
- **WHEN** a case runs 10 times on 2 models
- **THEN** all 20 runs ask about the same slug

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
