# Spec Delta

## ADDED Requirements

### Requirement: Numbers and booleans may be sent as text
`search_models` SHALL read every numeric argument as a number or as the text of one, and every boolean argument (`paid_only`, `zero_data_retention`) as a boolean or as the text `"true"` or `"false"`. It SHALL apply the range of the argument to the value it read, and SHALL send the API the number or boolean, never the text. Text counts as a number when, after trimming spaces, it is a decimal with an optional sign, an optional point and an optional exponent, and the value is finite.

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
| `min_intelligence_index`, `min_coding_index`, `min_agentic_index` | `a score, 0 or more` |
| `min_tool_success_rate` | `a rate from 0 to 1` |
| `max_age_days` | `a whole number of days, 0 or more` |
| `limit` | `a whole number from 1 to 50` |
| `offset` | `a whole number, 0 or more` |

#### Scenario: Boolean text
- **WHEN** the model sends the value of the row for `paid_only` or `zero_data_retention`
- **THEN** the call has the result the table gives

| Value | Result |
| --- | --- |
| `true`, `"true"` | read as `true` |
| `false`, `"false"` | read as `false` |
| `"True"`, `"yes"`, `"1"`, `""`, `1` | validation failure |

#### Scenario: A number and its text agree
- **WHEN** a number and its text are sent for the same numeric argument
- **THEN** both calls are valid or both fail, and the value read is the same

#### Scenario: The API gets the number
- **WHEN** the model sends `min_context_length: " 200000 "`, `limit: "5"` and `zero_data_retention: "false"`
- **THEN** the request carries `context=200000` and `limit=5`, and no `zdr`

## MODIFIED Requirements

### Requirement: Argument errors tell the model what to send
A validation failure on `sort`, `input_per_output`, `paid_only`, `zero_data_retention` or any numeric argument SHALL return a tool result that names the argument, states the rule it broke, shows the value sent where the rule concerns the value, and says what to send instead, so that the next call can succeed without a guess.

#### Scenario: Messages
- **WHEN** the model sends an argument from the table
- **THEN** the result is the error in the table, with the argument as its path

| Arguments | Error |
| --- | --- |
| `sort: "pricing-low-to-high"` | `sort: "pricing-low-to-high" is not offered. For the lowest input price use "input-price-low-to-high", for the lowest output price "output-price-low-to-high", for a mix of both "blended-price-low-to-high"; "-high-to-low" reverses each. The values are: …` |
| `paid_only: true`, no price sort | `paid_only: needs a price sort. Set sort to one of "input-price-low-to-high", "input-price-high-to-low", "output-price-low-to-high", "output-price-high-to-low", "blended-price-low-to-high", "blended-price-high-to-low".` |
| `input_per_output: 3`, no blended sort | `input_per_output: applies to a blended sort only. Set sort to "blended-price-low-to-high" or "blended-price-high-to-low", or leave input_per_output out.` |
| `input_per_output: 0` | `input_per_output: must be above 0, the input tokens for each output token, such as 3; got 0.` |
| `limit: "many"` | `limit: must be a whole number from 1 to 50; got "many".` |
| `limit: [1]` | `limit: must be a whole number from 1 to 50; got [1].` |
| `paid_only: "yes"` | `paid_only: must be true or false, sent as a boolean or as the text "true" or "false"; got "yes".` |
| `zero_data_retention: 1` | `zero_data_retention: must be true or false, sent as a boolean or as the text "true" or "false"; got 1.` |

#### Scenario: Every numeric argument
- **WHEN** the model sends `"abc"` for any numeric argument
- **THEN** the error starts with the name of the argument, says what the argument must be, and ends with `got "abc".`

### Requirement: Arguments describe themselves
The schema offered to the model SHALL give every argument of `search_models` a description that states what it means, its unit or accepted values, its default, and which other arguments it needs, excludes or interacts with. The description of `sort` SHALL name every value it accepts, say for each who applies it (the API or the tool) and by what it orders, and name the blended sorts as the choice when the user gives no usage. The tool description SHALL say that price sorts and `paid_only` are applied by the tool over every match. The schema SHALL offer the types the tool reads, text included.

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

#### Scenario: Text is offered
- **WHEN** the schema is read
- **THEN** each numeric argument offers the types `number` and `string`, and its description says that numeric text such as `"3"` is read as a number

#### Scenario: Booleans say what each value does
- **WHEN** the schema is read
- **THEN** each boolean argument offers the types `boolean` and `string`, and its description says that the text `"true"` or `"false"` is accepted, and what `true`, `false` and absence do
