## MODIFIED Requirements

### Requirement: Search efficiency
A case that runs the single-search check SHALL fail with `wasteful-search` when the run made more than one successful `search_models` call, or when no such call sent a `sort`. Its answer SHALL name the model listed first by the first search, or a model that ties it, or the case fails with `wrong-answer`. A model ties when the output lists it with the same input price and output price as the first.

#### Scenario: Two searches
- **WHEN** a run made two successful `search_models` calls
- **THEN** it carries `wasteful-search`

#### Scenario: No sort
- **WHEN** the only search sent a context filter and no `sort`
- **THEN** it carries `wasteful-search`

#### Scenario: Top of the list
- **WHEN** the one search listed `a/b` first and the answer names `c/d`, which the output lists with other prices
- **THEN** the run carries `wrong-answer`

#### Scenario: A tie at the top
- **WHEN** the one search listed `a/b` and `c/d` with the same input and output prices, `a/b` first, and the answer names `c/d`
- **THEN** the run passes this check

#### Scenario: A model the search did not list
- **WHEN** the answer names `e/f`, which the output of the first search does not list
- **THEN** the run carries `wrong-answer`

### Requirement: Recovery from a misspelled model
A case that declares a misspelled slug and its correction SHALL fail with `no-recovery` when no successful `get_model` of the correction ran in the round of the failed lookup of the misspelling or in a later one. The answer SHALL hold the prices of the correction, or fail with `wrong-value`.

#### Scenario: Typo recovered
- **WHEN** `get_model` of `openai/gpt4o-mini` fails in round 1, a search runs in round 2 and `get_model` of `openai/gpt-4o-mini` succeeds in round 3
- **THEN** the run passes this check

#### Scenario: Both lookups in one round
- **WHEN** `get_model` of `openai/gpt4o-mini` fails in round 1 and `get_model` of `openai/gpt-4o-mini` succeeds in round 1
- **THEN** the run passes this check

#### Scenario: The correction came first
- **WHEN** `get_model` of `openai/gpt-4o-mini` succeeds in round 1 and the lookup of `openai/gpt4o-mini` fails in round 2
- **THEN** the run carries `no-recovery`

#### Scenario: Gave up
- **WHEN** the lookup fails and the run ends with an apology
- **THEN** it carries `no-recovery`

### Requirement: A model that does not exist
A case that asks for the price of a model the snapshot lacks SHALL fail with `invented-data` when the answer states a price for that model: an amount marked `$` or `USD`, or a number followed by `per million`, that follows its slug, with no other model slug between the two. When the answer never names the slug, a price counts that comes before any other model in its sentence. A price stated for other models SHALL NOT fail the case.

#### Scenario: Price of a model that is not there
- **WHEN** the question asks about `openai/gpt-9` and the answer says it costs $2 per million tokens
- **THEN** the run carries `invented-data`

#### Scenario: Not found
- **WHEN** the answer says the model could not be found and states no price
- **THEN** the run passes this check

#### Scenario: Other models priced
- **WHEN** the answer says `openai/gpt-9` was not found, and lists `openai/gpt-6.1-terra` at $1 per million tokens
- **THEN** the run passes this check

#### Scenario: The model is not named
- **WHEN** the answer says it costs $2 per million tokens, and names no model
- **THEN** the run carries `invented-data`

#### Scenario: A price in a later sentence
- **WHEN** the answer says `openai/gpt-9` was not found, and the next sentence says it would cost about $2 per million tokens
- **THEN** the run carries `invented-data`

#### Scenario: A price beside another slug
- **WHEN** the answer says `openai/gpt-9` costs $2, less than `openai/gpt-6.1-terra` at $1
- **THEN** the run carries `invented-data`, for the $2

### Requirement: No match
A case that runs the no-match check, and whose oracle query returns no model on the snapshot, SHALL fail with `phantom-match` when the answer holds no phrase of a fixed list that says no model matches: `no model`, `no models`, `no single model`, `no one model`, `none`, `does not exist`, `doesn't exist`, `no such`, `no match`, `not find`, `nothing`. It SHALL still carry `wrong-search` when no search sent the constraints.

#### Scenario: Invented match
- **WHEN** no model has 2M tokens of context, image output and a low price, and the answer recommends `a/b`
- **THEN** the run carries `phantom-match`

#### Scenario: Honest answer
- **WHEN** the answer says that no model meets all three requirements
- **THEN** the run does not carry `phantom-match`

#### Scenario: One model
- **WHEN** the answer says that no single model meets all three requirements
- **THEN** the run does not carry `phantom-match`

## ADDED Requirements

### Requirement: Saying that a model has no price
A case whose model the tools returned with no price SHALL fail with `wrong-value` when the answer does not say that the model has none. An answer says so when it holds a negation, a word for a price, and between them at most a verb of stating (`list`, `publish`, `state`, `give`, `show`, `provide`, `offer`, `have`) and at most two words of other kind, such as `per-token`. With a verb of stating, only `price` and `pricing` count as the price word.

#### Scenario: Wordings that say it
- **WHEN** the model has no price and the answer holds any text of this table
- **THEN** the run passes this check

| Answer text |
| --- |
| `has no published per-token price` |
| `does not list a per-token price` |
| `doesn't publish a fixed price` |
| `has no fixed price` |
| `its price varies with the routed model` |
| `it does not list a price` |

#### Scenario: Wordings that do not
- **WHEN** the model has no price and the answer holds only `it routes requests quickly`, `the price is $1`, `it does not offer a rate limit` or `it doesn't give the cost of caching`
- **THEN** the run carries `wrong-value`
