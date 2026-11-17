# Spec Delta

## MODIFIED Requirements

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
