# model-tools Specification

## Purpose
Defines the two tools the model uses to read OpenRouter's catalog: `get_model` for one model and `search_models` for filtered, sorted lists. Fixes their arguments, units and results.

## Requirements

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
| `min_intelligence_index`, `min_coding_index`, `min_agentic_index` | number ≥ 0 | benchmark floors |
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

### Requirement: search_models result
`search_models` SHALL return `total` (matches in the catalog), `offset`, `next_offset` (`null` on the last page) and `models`, in the order of the sort: the API's for an API sort, the tool's for a price sort. Each model holds `id`, `name`, `context_length`, `max_completion_tokens`, `prompt_price`, `completion_price`, `input_modalities`, `output_modalities`, `supports_reasoning`, `intelligence_index`, `coding_index`, `agentic_index` and `created`. It SHALL NOT hold the description.

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

### Requirement: Price sorts
A `sort` of `input-price-*`, `output-price-*` or `blended-price-*` SHALL order every match of the other arguments by that price, `low-to-high` ascending or `high-to-low` descending. The blended price is (`input_per_output` × input price + output price) / (`input_per_output` + 1). A model with no price in a sort SHALL come last in both directions. Models with equal prices SHALL come in ascending order of `id`.

#### Scenario: Cheapest input is not the cheapest average
- **WHEN** the matches are `a/x` (input 0.015, output 0.045), `b/y` (input 0.007, output 6.8) and `c/z` (input 0.021, output 0.063), and the sort is `input-price-low-to-high`
- **THEN** `models` holds `b/y`, `a/x`, `c/z`, in that order

#### Scenario: Blended price
- **WHEN** the sort is `blended-price-low-to-high` with `input_per_output: 3`, `a/x` costs 1 input and 5 output, and `b/y` costs 2 input and 1 output
- **THEN** the blended prices are 2 and 1.75, and `b/y` comes first

#### Scenario: Missing price and ties
- **WHEN** the sort is `output-price-high-to-low`, `c/z` has a `null` output price, and `a/x` and `b/y` both cost 3 on output
- **THEN** the order is `a/x`, `b/y`, `c/z`

### Requirement: Arguments describe themselves
The schema offered to the model SHALL give every argument of `search_models` a description that states what it means, its unit or accepted values, its default, and which other arguments it needs, excludes or interacts with. The description of `sort` SHALL name every value it accepts, say for each who applies it (the API or the tool) and by what it orders, and name the blended sorts as the choice when the user gives no usage. The tool description SHALL say that price sorts and `paid_only` are applied by the tool over every match.

#### Scenario: Every value is named
- **WHEN** the schema of `search_models` is read
- **THEN** every value of the `sort` enum appears in the description of `sort`, and the description says that models without a score or a price come last

#### Scenario: Compatibility is stated
- **WHEN** the schema is read
- **THEN** the description of `input_per_output` names the `blended-price-*` sorts as its only use, the description of `paid_only` names the price sorts as its only use, and each states what happens otherwise

#### Scenario: Prices say whose price and what bound
- **WHEN** the schema is read
- **THEN** the description of each price bound names the input or the output price, the unit USD per million tokens, and that the bound is inclusive, and says that a free model has price 0

#### Scenario: Paging
- **WHEN** the schema is read
- **THEN** the descriptions of `limit` and `offset` give the range and default, and say that `next_offset` of the previous result is the next `offset`

#### Scenario: Sort when the user gives no usage
- **WHEN** the schema is read
- **THEN** the description of `sort` says to use `blended-price-low-to-high` or `blended-price-high-to-low` when the user states no usage, and that the default mix is 3

### Requirement: Argument errors tell the model what to send
A validation failure on `sort`, `input_per_output` or `paid_only` SHALL return a tool result that names the argument, states the rule it broke and says what to send instead, so that the next call can succeed without a guess.

#### Scenario: Messages
- **WHEN** the model sends an argument from the table
- **THEN** the result is the error in the table, with the argument as its path

| Arguments | Error |
| --- | --- |
| `sort: "pricing-low-to-high"` | `sort: "pricing-low-to-high" is not offered. For the lowest input price use "input-price-low-to-high", for the lowest output price "output-price-low-to-high", for a mix of both "blended-price-low-to-high"; "-high-to-low" reverses each. The values are: …` |
| `paid_only: true`, no price sort | `paid_only: needs a price sort. Set sort to one of "input-price-low-to-high", "input-price-high-to-low", "output-price-low-to-high", "output-price-high-to-low", "blended-price-low-to-high", "blended-price-high-to-low".` |
| `input_per_output: 3`, no blended sort | `input_per_output: applies to a blended sort only. Set sort to "blended-price-low-to-high" or "blended-price-high-to-low", or leave input_per_output out.` |
| `input_per_output: 0` | `input_per_output: must be above 0, the input tokens for each output token, such as 3.` |

### Requirement: Paid only
With `paid_only: true` and a price sort, `search_models` SHALL drop every model whose input price and output price are both 0, and every model with a `null` price. `total` and the pages SHALL count the models that remain.

#### Scenario: Free models dropped
- **WHEN** 262 models match, 17 of them cost nothing, 8 have a `null` price, and `paid_only` is true
- **THEN** `total` is 237 and no free or unpriced model appears on any page

### Requirement: Price sorts use one fetch per filter set
A price sort SHALL read every match of the API filters through as many pages as it takes, and keep the result in memory for the rest of the run. A later call with the same API filters, and any other sort, `paid_only`, `input_per_output`, `limit` or `offset`, SHALL make no request. A failed fetch SHALL NOT be kept. A call with an API sort SHALL fetch one page and keep nothing.

#### Scenario: Paging through a sort
- **WHEN** the model asks for `input-price-low-to-high` with `limit: 10`, then again with `offset: 10`
- **THEN** the API receives the requests of the first call only

#### Scenario: Another sort of the same matches
- **WHEN** the model then asks for `output-price-low-to-high` with the same filters
- **THEN** the API receives no request

#### Scenario: Other filters
- **WHEN** the model asks for the same sort with a different `min_context_length`
- **THEN** the API receives the requests for the new filters

#### Scenario: Failure
- **WHEN** the API fails on the second page of a fetch
- **THEN** the call returns the error as a tool result, and the next call with the same filters fetches again

#### Scenario: Too many matches
- **WHEN** the matches would take more than 5 pages of 1000
- **THEN** the call returns a tool result that asks the model to narrow the filters, and nothing is kept
