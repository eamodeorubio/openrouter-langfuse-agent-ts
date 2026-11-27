# Spec Delta

## MODIFIED Requirements

### Requirement: get_model result
`get_model` SHALL return these fields of the API's model: `id`, `name`, `description`, `created` (ISO date), `knowledge_cutoff`, `expiration_date`, `context_length`, `max_completion_tokens`, `input_modalities`, `output_modalities`, `tokenizer`, `supported_parameters`, `pricing`, `reasoning`, `benchmarks`. Fields the API omits SHALL be omitted. It SHALL return no other field. `benchmarks` SHALL NOT hold `coding_index` or `agentic_index`.

#### Scenario: Known model
- **WHEN** the API returns a model with pricing, reasoning and benchmarks
- **THEN** the result holds each of those fields and `pricing` is in USD per million tokens

#### Scenario: Which prices
- **WHEN** the API pricing holds `prompt`, `completion`, `input_cache_read`, `request`, `image`, `web_search` and `overrides`
- **THEN** `pricing` holds `prompt`, `completion`, `input_cache_read` and `overrides`, each token price in USD per million tokens, and no per-request, image, audio or web-search price

#### Scenario: Retired indexes
- **WHEN** the API returns `coding_index` and `agentic_index`, null or not
- **THEN** `benchmarks.artificial_analysis` holds neither and keeps the other indexes

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

### Requirement: search_models result
`search_models` SHALL return `total` (matches in the catalog), `offset`, `next_offset` (`null` on the last page) and `models`, in the order of the sort: the API's for an API sort, the tool's for a price sort. Each model holds `id`, `name`, `context_length`, `max_completion_tokens`, `prompt_price`, `completion_price`, `input_modalities`, `output_modalities`, `supports_reasoning`, `intelligence_index` and `created`. It SHALL NOT hold the description, `coding_index` or `agentic_index`.

#### Scenario: Page of two
- **WHEN** the API returns 2 models of 37 matches for `offset: 0`
- **THEN** `total` is 37, `next_offset` is 2, and `models` has 2 entries

#### Scenario: Last page
- **WHEN** the API reports no next page
- **THEN** `next_offset` is `null`

### Requirement: Numbers and booleans may be sent as text
`search_models` SHALL read every numeric argument as a number or as the text of one, and every boolean argument (`paid_only`, `zero_data_retention`) as a boolean or as the text `true` or `false` in any letter case. It SHALL apply the range of the argument to the value it read, and SHALL send the API the number or boolean, never the text. Text counts as a number when, after trimming spaces, it is a decimal with an optional sign, an optional point and an optional exponent, and the value is finite.

#### Scenario: Numeric text
- **WHEN** the model sends the text of the row for a numeric argument
- **THEN** the call has the result the table gives

| Text | Result |
| --- | --- |
| `"200000"`, `" 3 "`, `"+3"`, `".5"`, `"3."`, `"1e3"`, `"0003"` | valid, read as that number |
| `""`, `" "`, `"abc"`, `"0x10"`, `"Infinity"`, `"NaN"`, `"1,000"`, `"3 tokens"`, `"1e999"` | validation failure |
| `"0"` for `limit`, `"51"` for `limit`, `"2.5"` for `limit` | validation failure, as the number would |

#### Scenario: What each numeric argument must be
- **WHEN** a numeric argument gets a value it does not accept
- **THEN** the error says `must be` and the phrase of the table, then `; got` and the value

| Argument | Phrase |
| --- | --- |
| `input_per_output` | `above 0, the input tokens for each output token, such as 3` |
| `min_context_length` | `a whole number of tokens, 1 or more` |
| `min_prompt_price`, `max_prompt_price`, `min_completion_price`, `max_completion_price` | `a price in USD per million tokens, 0 or more` |
| `min_intelligence_index` | `a score, 0 or more` |
| `min_tool_success_rate` | `a rate from 0 to 1` |
| `max_age_days` | `a whole number of days, 0 or more` |
| `limit` | `a whole number from 1 to 50` |
| `offset` | `a whole number, 0 or more` |

#### Scenario: Boolean text
- **WHEN** the model sends the value of the row for `paid_only` or `zero_data_retention`
- **THEN** the call has the result the table gives

| Value | Result |
| --- | --- |
| `true`, `"true"`, `"True"`, `"TRUE"`, `"tRuE"` | read as `true` |
| `false`, `"false"`, `"False"`, `"FALSE"`, `"fAlSe"` | read as `false` |
| `"yes"`, `"1"`, `"0"`, `""`, `" true"`, `"truee"`, `"falſe"`, `1`, `0` | validation failure |
| `null` | read as absent |

#### Scenario: Refused booleans keep the error
- **WHEN** the model sends `paid_only: "Yes"`
- **THEN** the error is `paid_only: must be true or false, sent as a boolean or as the text "true" or "false"; got "Yes".`

#### Scenario: Case does not change the call
- **WHEN** `paid_only` is sent as `"True"`, `"TRUE"` and `true` with the same other arguments
- **THEN** the three calls return the same result and send the same request

#### Scenario: A number and its text agree
- **WHEN** a number and its text are sent for the same numeric argument
- **THEN** both calls are valid or both fail, and the value read is the same

#### Scenario: The API gets the number
- **WHEN** the model sends `min_context_length: " 200000 "`, `limit: "5"` and `zero_data_retention: "False"`
- **THEN** the request carries `context=200000` and `limit=5`, and no `zdr`
