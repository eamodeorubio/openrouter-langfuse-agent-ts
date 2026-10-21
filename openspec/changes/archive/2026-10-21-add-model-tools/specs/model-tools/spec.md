# Spec Delta

## Purpose

Defines the two tools the model uses to read OpenRouter's catalog: `get_model` for one model and `search_models` for filtered, sorted lists. Fixes their arguments, units and results.

## ADDED Requirements

### Requirement: get_model arguments
`get_model` SHALL take one argument, `slug`: `author/name`, with an optional `:variant` suffix. A value that is not two non-empty parts around one `/` SHALL fail validation.

| `slug` | Result |
| --- | --- |
| `openai/gpt-5` | valid |
| `openai/gpt-5:free` | valid |
| `gpt-5`, `/gpt-5`, `openai/`, `a/b/c`, `` | validation failure |

#### Scenario: Request path
- **WHEN** the model calls `get_model` with `openai/gpt-5:free`
- **THEN** the CLI requests `GET /api/v1/model/openai/gpt-5:free`

### Requirement: get_model result
`get_model` SHALL return these fields of the API's model: `id`, `name`, `description`, `created` (ISO date), `knowledge_cutoff`, `expiration_date`, `context_length`, `max_completion_tokens`, `input_modalities`, `output_modalities`, `tokenizer`, `supported_parameters`, `pricing`, `reasoning`, `benchmarks`. Fields the API omits SHALL be omitted. It SHALL return no other field.

#### Scenario: Known model
- **WHEN** the API returns a model with pricing, reasoning and benchmarks
- **THEN** the result holds each of those fields and `pricing` is in USD per million tokens

#### Scenario: Which prices
- **WHEN** the API pricing holds `prompt`, `completion`, `input_cache_read`, `request`, `image`, `web_search` and `overrides`
- **THEN** `pricing` holds `prompt`, `completion`, `input_cache_read` and `overrides`, each token price in USD per million tokens, and no per-request, image, audio or web-search price

### Requirement: Prices in USD per million tokens
Every price a tool returns SHALL be a number in USD per million tokens, converted from the API's per-token decimal string by an exact decimal shift. A price that is not a non-negative decimal string, such as the `-1` of a routing model, SHALL become `null`.

| API string | Tool value |
| --- | --- |
| `0.000003` | `3` |
| `0.0000001` | `0.1` |
| `0` | `0` |
| `-1` | `null` |
| `abc`, `` | `null` |

#### Scenario: No floating error
- **WHEN** the API prices are `0.000003`, `0.0000015` and `0.00000007`
- **THEN** the tool values are `3`, `1.5` and `0.07`

### Requirement: search_models arguments
`search_models` SHALL accept the arguments below, all optional, and SHALL send each given one to `GET /api/v1/models` under the API's own name. A `null` value SHALL be read as the argument being absent. Unknown arguments SHALL fail validation.

#### Scenario: Accepted arguments
| Argument | Type | Meaning |
| --- | --- | --- |
| `query` | string | free text over name and slug |
| `category` | enum | use case, as the API lists them |
| `sort` | enum | server-side order, as the API lists them |
| `input_modalities`, `output_modalities` | string list | modalities required |
| `supported_parameters` | string list | parameters required, such as `tools` |
| `min_context_length` | integer ≥ 1 | context window floor |
| `min_prompt_price`, `max_prompt_price` | number ≥ 0 | USD per million input tokens |
| `min_completion_price`, `max_completion_price` | number ≥ 0 | USD per million output tokens |
| `architecture`, `authors`, `providers` | string, string list, string list | family, author slugs, hosting providers |
| `min_intelligence_index`, `min_coding_index`, `min_agentic_index` | number ≥ 0 | benchmark floors |
| `min_tool_success_rate` | number 0 to 1 | tool-calling reliability floor |
| `max_age_days` | integer ≥ 0 | newest models only |
| `zero_data_retention` | boolean | only models with zero-data-retention endpoints |
| `limit` | integer 1 to 50, default 10 | page size |
| `offset` | integer ≥ 0, default 0 | records to skip |

#### Scenario: Cheap tool-capable models
- **WHEN** the model calls `search_models` with `sort: "pricing-low-to-high"`, `supported_parameters: ["tools"]`, `limit: 5`
- **THEN** the request carries `sort=pricing-low-to-high`, `supported_parameters=tools`, `limit=5`

#### Scenario: Null as absent
- **WHEN** the model sends every argument as `null`, as some providers make it do
- **THEN** the call is valid, the request carries only `limit=10` and `offset=0`, and the schema offered to the model allows `null` for each optional argument

#### Scenario: Bounds
| `limit` | Result |
| --- | --- |
| 1, 50 | valid |
| 0, 51, 2.5, `"ten"` | validation failure |

### Requirement: search_models result
`search_models` SHALL return `total` (matches in the catalog), `offset`, `next_offset` (`null` on the last page) and `models`, in the API's order. Each model holds `id`, `name`, `context_length`, `max_completion_tokens`, `prompt_price`, `completion_price`, `input_modalities`, `output_modalities`, `supports_reasoning`, `intelligence_index`, `coding_index`, `agentic_index` and `created`. It SHALL NOT hold the description.

#### Scenario: Page of two
- **WHEN** the API returns 2 models of 37 matches for `offset: 0`
- **THEN** `total` is 37, `next_offset` is 2, and `models` has 2 entries

#### Scenario: Last page
- **WHEN** the API reports no next page
- **THEN** `next_offset` is `null`

### Requirement: Tool requests use the key safely
Tool requests SHALL authenticate with `OPENROUTER_API_KEY` and go only to OpenRouter. No tool result and no `tool:` line SHALL contain the key's value.

#### Scenario: Key echoed by the API
- **WHEN** the API's error text for a tool call contains the key
- **THEN** the result sent to the model and every stderr line show `[redacted]` in its place
