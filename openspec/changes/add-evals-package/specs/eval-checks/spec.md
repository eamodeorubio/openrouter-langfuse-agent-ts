# Spec Delta

## Purpose

Defines the error classes, the checks that detect them, the judge rubrics and the cases of the eval sets, so that every failed run carries a named cause.

## ADDED Requirements

### Requirement: Error classes
Every check SHALL be tagged with one class as its metric name. A failed check SHALL be recorded under that class.

#### Scenario: Tag
- **WHEN** a check fails
- **THEN** the failure is recorded under the metric named after its class

#### Scenario: The classes
- **WHEN** a check is defined
- **THEN** its class is one of these

| Class | The run |
| --- | --- |
| `run-failed` | ended without an answer: API error, round cap, timeout |
| `memory-answer` | needed a lookup and made no successful tool call |
| `wrong-search` | made lookups that could not surface an acceptable answer |
| `wrong-answer` | had an acceptable answer in its lookups and named none |
| `invented-data` | named a model that no source holds |
| `wrong-value` | stated a figure that differs from the tool output |
| `arithmetic-in-head` | needed arithmetic and never called `calculate` |
| `needless-lookup` | looked up data the question already held |

### Requirement: Precedence
A run SHALL carry at most one class from the chain `run-failed`, `memory-answer`, `wrong-search`, `wrong-answer`, then `invented-data` or `wrong-value`. A check later in the chain SHALL pass without judging when an earlier one failed. `arithmetic-in-head` and `needless-lookup` SHALL be independent of the chain, except after `run-failed`.

#### Scenario: No lookup
- **WHEN** a run made no tool call and its answer names `openai/gpt-9`
- **THEN** the run carries `memory-answer` and not `invented-data`

#### Scenario: Failed run
- **WHEN** a run ends in a provider error
- **THEN** it carries `run-failed` only

### Requirement: Pass
A run SHALL pass when it carries no class. A check with weight 0 SHALL be recorded and SHALL NOT affect a pass.

#### Scenario: Judge below threshold
- **WHEN** a run fires no class and a judge rubric scores 0.3
- **THEN** the run passes and the score is recorded

### Requirement: Run failed
A run SHALL carry `run-failed` when it is a provider error, or when its success object holds an empty `answer`.

#### Scenario: Blank answer
- **WHEN** the CLI exits 0 with `answer` equal to `"  "`
- **THEN** the run carries `run-failed`

### Requirement: Memory answer
A case that declares `needsLookup` SHALL fail with `memory-answer` when no tool call of the run succeeded. A call succeeded when its `failed` field is false.

#### Scenario: Only failed calls
- **WHEN** a lookup case ran two `get_model` calls and both have `failed: true`
- **THEN** the run carries `memory-answer`

### Requirement: Invented models
After a successful lookup, a model named in the answer SHALL appear in the question or in a tool output, or the run carries `invented-data`.

#### Scenario: Invented slug
- **WHEN** the tools returned `openai/gpt-5` and the answer recommends `openai/gpt-9`
- **THEN** the run carries `invented-data`

#### Scenario: What counts as a name
- **WHEN** the answer holds a token of the shape `author/name` with an optional `:variant`
- **THEN** it is a model name if its author is an author in the snapshot, or if it is in backticks

| Answer text | Names |
| --- | --- |
| `Use openai/gpt-oss-20b.` | `openai/gpt-oss-20b` |
| `nvidia/nemotron-3-ultra-550b-a55b:free, then` | `nvidia/nemotron-3-ultra-550b-a55b:free` |
| `see https://openrouter.ai/models` | none |
| `input/output and 24/7` | none |
| `` `fakeco/x-1` `` | `fakeco/x-1` |

#### Scenario: Suffixes
- **WHEN** a source holds `a/b:free`
- **THEN** the answer slug `a/b` is grounded and the answer slug `a/b:beta` is not

### Requirement: Asked figures
A case SHALL name the figures its answer must hold. Each expected figure SHALL come from the run's own tool outputs. A missing or different figure SHALL fail with `wrong-value`. When the output holds no figure for the asked model the run SHALL fail with `wrong-search`.

#### Scenario: Matching rules
- **WHEN** an expected figure is looked for in the answer
- **THEN** it matches as this table says

| Figure | Matches in the answer |
| --- | --- |
| price, tolerance 0 | the number, with or without a currency mark or trailing zeros: `0.03`, `$0.030` |
| token count, tolerance 0 | the digits with or without separators, or a `k` or `m` form equal to count/1000 or count/1024, or count/10^6 or count/1024², at the stated precision: `131,072`, `131 072` (a space, a no-break space, a narrow no-break space or a thin space), `131k`, `128k` for 131072 |
| cost, tolerance 1% | a money amount, marked `$` or `USD`, within 1%: `$3.02` for 3.00 |

#### Scenario: Wrong price
- **WHEN** the output holds an input price of 0.05 and the answer states 0.50
- **THEN** the run carries `wrong-value`

#### Scenario: Unmarked count
- **WHEN** the answer says `90 million tokens` and the expected cost is 90
- **THEN** that number does not match, because it carries no `$` or `USD`

### Requirement: Search checks
A case that names an oracle query SHALL fail with `wrong-search` when no successful search or lookup output holds an acceptable slug, or when the search arguments omit a constraint the case requires. It SHALL fail with `wrong-answer` when the answer names no acceptable slug.

#### Scenario: Constraint dropped
- **WHEN** the case requires `min_context_length` of at least 200000 and the call sent none
- **THEN** the run carries `wrong-search`

#### Scenario: Search right, answer wrong
- **WHEN** a search output holds an acceptable slug and the answer names another
- **THEN** the run carries `wrong-answer`

### Requirement: Tool use checks
A case that declares `needsArithmetic` SHALL fail with `arithmetic-in-head` when no `calculate` call succeeded. A case that declares `needsLookup: false` SHALL fail with `needless-lookup` when the run called `get_model` or `search_models`.

#### Scenario: Calculation by hand
- **WHEN** a cost case ends with no `calculate` call
- **THEN** the run carries `arithmetic-in-head`

#### Scenario: Prices given
- **WHEN** the question holds the prices and the run calls `get_model`
- **THEN** the run carries `needless-lookup`

### Requirement: Judge rubrics
Four yes/no rubrics SHALL grade each run with Jev 1.14 through OpenRouter, as the model `typesafe/jev-1.14`: `judge-grounding`, `judge-relevance`, `judge-usefulness` and `judge-tool-usage`. Each SHALL have weight 0 and a threshold of 0.7, use no score levels and be phrased so that yes is good.

#### Scenario: Questions and state
- **WHEN** a run is graded
- **THEN** each rubric asks its question over the state in this table

| Rubric | Question | State sent |
| --- | --- | --- |
| `judge-grounding` | Is every price, context size and capability in the answer given in the tool results? | tool calls with arguments and outputs, answer |
| `judge-relevance` | Does the answer address the question that was asked? | question, tool calls, answer |
| `judge-usefulness` | Would the answer let the person decide or act? | question, tool calls, answer |
| `judge-tool-usage` | Were the tool calls relevant to the question? | question, tool calls with arguments |

#### Scenario: Recorded score
- **WHEN** Jev returns 0.62 for a rubric
- **THEN** the run records 0.62 under that rubric and the rubric counts as below its threshold

### Requirement: Judge state limit
When the state for a rubric exceeds 32,000 bytes the rubric SHALL record no score and SHALL say that the state was too large. The state SHALL NOT be cut.

#### Scenario: Large search output
- **WHEN** the tool outputs make the grounding state 40,000 bytes
- **THEN** `judge-grounding` records no score and names the size

### Requirement: Cases and sets
The core set SHALL hold A1, B7 and C1. The full set SHALL hold those and A3, A5, B2 and B3. Each case SHALL carry its code in `metadata.id` and a one-line `description` of what it tests, and SHALL declare its checks.

#### Scenario: Case identity
- **WHEN** a case is defined
- **THEN** its `description` is one line of several words that says what it tests, and its code is in `metadata.id`

#### Scenario: Case table
- **WHEN** a case is defined
- **THEN** it declares what this table lists for it

| Case | Asks | Declares | Checks beyond the universal ones |
| --- | --- | --- | --- |
| A1 | price and context of `openai/gpt-oss-20b` | `needsLookup` | asked figures: input price, output price, context |
| A3 | price of `freeModel` | `needsLookup` | output price is 0, answer says it is free and holds no non-zero price |
| A5 | price of `openrouter/auto` | `needsLookup` | output price is `null`, answer says there is no fixed price and holds no price figure |
| B2 | monthly cost of 2,000 chats a day, 1,500 tokens in and 400 out, 30 days, on one named model | `needsLookup`, `needsArithmetic` | cost = 90M × input price + 24M × output price, tolerance 1% |
| B3 | the same workload on two named models and their cost ratio | `needsLookup`, `needsArithmetic` | both costs and the ratio, tolerance 1%, either orientation; both models looked up |
| B7 | cost of 3M input and 1M output tokens at 0.50 and 1.50 USD per million, given in the question | `needsLookup: false`, `needsArithmetic` | answer holds 3.00 USD within 1% |
| C1 | cheapest paid model with at least 200,000 tokens of context and tool calling, at 3 input tokens per output token | `needsLookup` | query `cheapest-blended`, constraints `min_context_length` 200000 and `supported_parameters` `tools` |

#### Scenario: Core run
- **WHEN** the core `eval` script runs
- **THEN** it runs A1, B7 and C1 on every model of the matrix

#### Scenario: Full run
- **WHEN** the full `eval` script runs
- **THEN** it runs all seven cases on every model of the matrix
