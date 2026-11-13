# Spec Delta

## Purpose

Defines the catalog snapshot an eval run takes before its first case, the named queries that turn it into expected answers, and the variables cases draw from it.

## ADDED Requirements

### Requirement: Snapshot before the first run
An eval run SHALL fetch OpenRouter's public model list once, before the first case starts, and SHALL save it with the time it was fetched beside the run's results. When the fetch fails the run SHALL stop before any case, exit non-zero and say why.

#### Scenario: Snapshot taken
- **WHEN** an eval run starts and the model list is reachable
- **THEN** a snapshot file with the model list and a fetch time exists before the first CLI start

#### Scenario: Fetch fails
- **WHEN** the model list request fails
- **THEN** no case runs, stderr names the failure and the exit code is non-zero

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

### Requirement: Query invariants
Every query SHALL return a subset of the snapshot, SHALL NOT depend on the order of the snapshot, SHALL NOT add a model when a constraint tightens, and SHALL NOT throw on an empty snapshot.

#### Scenario: Tighter constraint
- **WHEN** `minContext` rises from 200000 to 250000
- **THEN** the new result is a subset of the old result

#### Scenario: Empty snapshot
- **WHEN** a query runs on an empty snapshot
- **THEN** it returns an empty result

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
