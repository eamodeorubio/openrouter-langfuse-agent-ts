## ADDED Requirements

### Requirement: Advice on paid_only is conditional
The schema of `search_models` SHALL advise `paid_only` only when the user asks for a paid model, and SHALL say that when the question does not ask for one, a free model is a valid answer and `paid_only` is left out. No description of the tool, and no line of the system message, SHALL advise `paid_only` without that condition. No description or message SHALL name an eval case, a question or a model id.

#### Scenario: Both descriptions state the condition
- **WHEN** the schema is read
- **THEN** the descriptions of `sort` and of `paid_only` each say to use `paid_only` only when the user asks for a paid model, and that a free model is otherwise a valid answer

#### Scenario: No unconditional advice
- **WHEN** the tool description, the descriptions of every argument and the system message are read
- **THEN** every sentence that tells the model to use or add `paid_only` is tied to the user asking for a paid model, and the text `add paid_only to skip free models` does not appear

#### Scenario: Descriptions say the text is read in any letter case
- **WHEN** the schema is read
- **THEN** the descriptions of `paid_only` and `zero_data_retention` say that the text `"true"` or `"false"` is read in any letter case

## MODIFIED Requirements

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
