# Spec Delta

## MODIFIED Requirements

### Requirement: Search checks
A case that names an oracle query SHALL fail with `wrong-search` when no successful call output holds an acceptable slug, or when the run made a `search_models` call and none of those calls carries every filter the case declares in its `search`. A case with no acceptable model, a count or a sorted search SHALL still fail with `wrong-search` when no successful search carried those filters. It SHALL fail with `wrong-answer` when the answer names no acceptable slug.

#### Scenario: Constraint dropped
- **WHEN** the case requires `min_context_length` of at least 200000 and the call sent none
- **THEN** the run carries `wrong-search`

#### Scenario: A required sort
- **WHEN** the case requires `sort` to be `blended-price-low-to-high` and a call sent that value
- **THEN** the call carries that constraint

#### Scenario: Constraints in a list
- **WHEN** the case requires `supported_parameters` to hold `tools` and a call sent `["reasoning", "tools"]`
- **THEN** the call carries that constraint

#### Scenario: A number sent as text
- **WHEN** the case requires `min_context_length` of at least 200000 and the call sends the value of the row
- **THEN** the call carries the constraint when the value is a number, or the text of one as the tool reads it, at or above 200000, as the table gives

| Sent | Carries the constraint |
| --- | --- |
| `200000`, `"200000"`, `" 300000 "`, `"3e5"` | yes |
| `"199999"`, `"plenty"`, `""`, `"0x30D40"`, `"1e999"` | no |

#### Scenario: A number and its text
- **WHEN** a call sends a number and another call sends the same number as text, with the same other arguments
- **THEN** the two calls carry the same constraints

#### Scenario: No search call
- **WHEN** the run only called `get_model` and one output holds an acceptable slug
- **THEN** the run does not carry `wrong-search`

#### Scenario: Search right, answer wrong
- **WHEN** a search output holds an acceptable slug and the answer names another
- **THEN** the run carries `wrong-answer`

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

#### Scenario: A paid question skips unpaid models
- **WHEN** the question holds the words `paid model` or `paid models`, so that models that are not paid do not count as listed and the first is the first paid model, as in "the cheapest paid model", the one search sent no `paid_only`, and the output lists a model with prices 0 and 0, a model with a `null` price and `c/d` with prices 0.02 and 0.1, in that order
- **THEN** the answer `c/d` passes this check, and an answer that names only the first two carries `wrong-answer`

#### Scenario: The skip does not depend on the search
- **WHEN** the question asks for a paid model and the search sent `paid_only: true`
- **THEN** the models that are not paid are skipped all the same, if the listing holds any

#### Scenario: What is paid
- **WHEN** the question asks for a paid model and the output lists a model of the row first; a model is paid when both its prices are numbers and at least one is above 0
- **THEN** the model counts as paid or not as the table says

| Input price | Output price | Paid |
| --- | --- | --- |
| 1 | 0 | yes |
| 0 | 2 | yes |
| 0 | 0 | no |
| 1 | `null` | no |
| `null` | 2 | no |

#### Scenario: A question that does not ask for a paid model
- **WHEN** the question holds the word `paid` in another sense, such as "what I paid last month"
- **THEN** no model is skipped
