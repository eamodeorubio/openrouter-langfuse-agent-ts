# Spec Delta

## ADDED Requirements

### Requirement: Benchmark indexes are explained
The descriptions offered to the model SHALL say how to read every Artificial Analysis index a tool can return: what it measures, its scale, that higher is better, and that a missing or null score means unscored, never zero. They SHALL ask the model to name Artificial Analysis when it quotes a score.

#### Scenario: get_model description
- **WHEN** the description of `get_model` is read
- **THEN** it names every index of the table with its scale

| Index | Scale |
| --- | --- |
| `intelligence_index` | 0 to 100 |
| `finance_and_accounting_index` | 0 to 100 |
| `strategy_and_ops_index` | 0 to 100 |
| `legal_index` | 0 to 100 |
| `healthcare_and_medical_index` | 0 to 100 |
| `engineering_index` | 0 to 100 |
| `economics_index` | 0 to 100 |
| `cyber_index` | 0 to 100 |
| `openness_index` | 0 to 100 |
| `multilingual_index` | 0 to 1 |
| `decision_index` | 0 to 100 |

#### Scenario: Comparing indexes
- **WHEN** the description of `get_model` is read
- **THEN** it says that each score is the best across the configurations tested, so two indexes of one model may come from different configurations

#### Scenario: Sort description
- **WHEN** the description of `sort` is read
- **THEN** it says which index each index sort ranks by, and that no index measures coding alone

## MODIFIED Requirements

### Requirement: get_model result
`get_model` SHALL return these fields of the API's model: `id`, `name`, `description`, `created` (ISO date), `knowledge_cutoff`, `expiration_date`, `context_length`, `max_completion_tokens`, `input_modalities`, `output_modalities`, `tokenizer`, `supported_parameters`, `pricing`, `reasoning`, `benchmarks`. Fields the API omits SHALL be omitted. It SHALL return no other field. `benchmarks` SHALL NOT hold `coding_index` or `agentic_index`, and `benchmarks.artificial_analysis` SHALL hold only the indexes that have a score.

#### Scenario: Known model
- **WHEN** the API returns a model with pricing, reasoning and benchmarks
- **THEN** the result holds each of those fields and `pricing` is in USD per million tokens

#### Scenario: Which prices
- **WHEN** the API pricing holds `prompt`, `completion`, `input_cache_read`, `request`, `image`, `web_search` and `overrides`
- **THEN** `pricing` holds `prompt`, `completion`, `input_cache_read` and `overrides`, each token price in USD per million tokens, and no per-request, image, audio or web-search price

#### Scenario: Retired indexes
- **WHEN** the API returns `coding_index` and `agentic_index`, null or not
- **THEN** `benchmarks.artificial_analysis` holds neither and keeps the other indexes

#### Scenario: Unscored indexes
- **WHEN** the API returns `legal_index: 41.2` and `cyber_index: null`
- **THEN** `benchmarks.artificial_analysis` holds `legal_index` and no `cyber_index`

#### Scenario: No score at all
- **WHEN** every Artificial Analysis index of the model is null
- **THEN** `benchmarks` holds no `artificial_analysis`

### Requirement: search_models arguments
`search_models` SHALL accept the arguments below, all optional, and SHALL send each given one to `GET /api/v1/models` under the API's own name, except `input_per_output`, `paid_only` and the price sorts, which the tool applies itself. A `null` value SHALL be read as the argument being absent. Unknown arguments SHALL fail validation.

#### Scenario: Accepted arguments
- **WHEN** the model sends an argument of the table
- **THEN** the call is valid when the value fits the type and range given

| Argument | Type | Meaning |
| --- | --- | --- |
| `query` | string | free text over name and slug |
| `category` | enum | use case, as the API lists them |
| `sort` | enum | an order the API applies, or a price order the tool applies |
| `input_per_output` | number > 0, default 3 | input tokens per output token, for a blended sort |
| `paid_only` | boolean | with a price sort, drop models that cost nothing or have no price |
| `input_modalities`, `output_modalities` | string list | modalities required |
| `supported_parameters` | string list | parameters required, such as `tools` |
| `min_context_length` | integer ≥ 1 | context window floor |
| `min_prompt_price`, `max_prompt_price` | number ≥ 0 | keep models whose input price is at least, or at most, this many USD per million tokens |
| `min_completion_price`, `max_completion_price` | number ≥ 0 | the same for the output price |
| `architecture`, `authors`, `providers` | string, string list, string list | family, author slugs, hosting providers |
| `min_intelligence_index` | number ≥ 0 | benchmark floor |
| `min_tool_success_rate` | number 0 to 1 | tool-calling reliability floor |
| `max_age_days` | integer ≥ 0 | newest models only |
| `zero_data_retention` | boolean | only models with zero-data-retention endpoints |
| `limit` | integer 1 to 50, default 10 | page size |
| `offset` | integer ≥ 0, default 0 | records to skip |

#### Scenario: Cheap tool-capable models
- **WHEN** the model calls `search_models` with `sort: "newest"`, `supported_parameters: ["tools"]`, `limit: 5`
- **THEN** the request carries `sort=newest`, `supported_parameters=tools`, `limit=5`

#### Scenario: Null as absent
- **WHEN** the model sends every argument as `null`, as some providers make it do
- **THEN** the call is valid, the request carries only `limit=10` and `offset=0`, and the schema offered to the model allows `null` for each optional argument

#### Scenario: Bounds
- **WHEN** the model sends a `limit` of the table
- **THEN** the call has the result the table gives

| `limit` | Result |
| --- | --- |
| 1, 50 | valid |
| 0, 51, 2.5, `"ten"` | validation failure |

#### Scenario: Removed sorts
- **WHEN** the model sends a `sort` from the table
- **THEN** the call has the result the table gives

| `sort` | Result |
| --- | --- |
| `pricing-low-to-high`, `pricing-high-to-low` | validation failure |
| `input-price-low-to-high`, `blended-price-high-to-low` | valid |

#### Scenario: Options that need a price sort
- **WHEN** the model sends the arguments of a row
- **THEN** the call has the result the table gives

| Arguments | Result |
| --- | --- |
| `input_per_output: 3` with a `blended-price-*` sort | valid |
| `input_per_output: 3` with any other sort or none | validation failure |
| `input_per_output: 0` or `-1` | validation failure |
| `paid_only: true` with a price sort | valid |
| `paid_only: true` with any other sort or none | validation failure |
| `paid_only: false` with any sort or none | valid, no effect |

#### Scenario: Retired benchmarks
- **WHEN** the model sends the argument of a row
- **THEN** the call fails validation, and no request is made

| Argument |
| --- |
| `sort: "coding-high-to-low"` |
| `sort: "agentic-high-to-low"` |
| `min_coding_index: 30` |
| `min_agentic_index: 20` |

#### Scenario: Index sorts
- **WHEN** the model sends a `sort` of the table
- **THEN** the request carries the same `sort`

| `sort` |
| --- |
| `finance-and-accounting-high-to-low` |
| `strategy-and-ops-high-to-low` |
| `legal-high-to-low` |
| `healthcare-and-medical-high-to-low` |
| `engineering-high-to-low` |
| `economics-high-to-low` |
| `cyber-high-to-low` |
| `openness-high-to-low` |
| `multilingual-high-to-low` |

#### Scenario: Decision index
- **WHEN** the model sends `sort: "decision-high-to-low"`
- **THEN** the call fails validation

### Requirement: search_models result
`search_models` SHALL return `total` (matches in the catalog), `offset`, `next_offset` (`null` on the last page) and `models`, in the order of the sort: the API's for an API sort, the tool's for a price sort. Each model holds `id`, `name`, `context_length`, `max_completion_tokens`, `prompt_price`, `completion_price`, `input_modalities`, `output_modalities`, `supports_reasoning`, `intelligence_index` and `created`. With a sort by another Artificial Analysis index, each model SHALL also hold that index under its own name, `null` when unscored. It SHALL NOT hold the description, `coding_index` or `agentic_index`.

#### Scenario: Page of two
- **WHEN** the API returns 2 models of 37 matches for `offset: 0`
- **THEN** `total` is 37, `next_offset` is 2, and `models` has 2 entries

#### Scenario: Last page
- **WHEN** the API reports no next page
- **THEN** `next_offset` is `null`

#### Scenario: The ranking value is shown
- **WHEN** the sort is `finance-and-accounting-high-to-low`
- **THEN** each entry holds `finance_and_accounting_index` and `intelligence_index`, and no other index

#### Scenario: Other sorts
- **WHEN** the sort is `newest`, a price sort, `intelligence-high-to-low` or absent
- **THEN** each entry holds `intelligence_index` as its only index
