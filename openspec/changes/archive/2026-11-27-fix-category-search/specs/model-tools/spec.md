# Spec Delta

## ADDED Requirements

### Requirement: Category requests
A `search_models` call with `category` SHALL send no `offset`, `limit` or `supported_parameters` to the API, as an exception to the arguments the tool passes on. It SHALL send every other filter, and an API sort, unchanged. A call without `category` SHALL send what it sent before.

#### Scenario: What the API receives
- **WHEN** the model searches with `category: "programming"`, `supported_parameters: ["tools"]`, `sort: "newest"`, `limit: 5` and `offset: 5`
- **THEN** the query of the request is `category=programming` and `sort=newest`, and nothing else

#### Scenario: Without a category
- **WHEN** the model searches with `limit: 5` and `supported_parameters: ["tools"]`
- **THEN** the request carries `limit=5`, `offset=0` and `supported_parameters=tools`

### Requirement: Category results are filtered and paged by the tool
With `category`, the tool SHALL keep the models that list every one of `supported_parameters`, then apply `offset` and `limit` to them in the order of the sort. `total` SHALL count the models kept, and `next_offset` SHALL be `null` on the last page.

#### Scenario: Required parameters
- **WHEN** the API returns `a/x` with `tools` and `seed`, `b/y` with `seed`, and `c/z` with `tools`, and the call requires `tools`
- **THEN** `models` holds `a/x` and `c/z`, in that order, and `total` is 2

#### Scenario: A page
- **WHEN** 5 models are kept, `limit` is 2 and `offset` is 2
- **THEN** `models` holds the third and the fourth, `total` is 5 and `next_offset` is 4

#### Scenario: Past the end
- **WHEN** `offset` is 9 and 5 models are kept
- **THEN** `models` is empty, `total` is 5 and `next_offset` is `null`

#### Scenario: Price sort
- **WHEN** the call has `category` and a price sort
- **THEN** the price order and `paid_only` apply to the kept models before the page, and a later page makes no request

### Requirement: A category list that continues is refused
When the API answers a category request with a link to a next page, the call SHALL return a tool result that says the list is incomplete and asks for a search without `category`. It SHALL NOT return part of the list.

#### Scenario: Next page offered
- **WHEN** the reply holds a non-null `links.next`
- **THEN** the result is that error, and no further request is made

### Requirement: The category description
The description of `category` SHALL say that the API answers with a short list it picks for that use, so that the cheapest or best of the list may not be the cheapest or best of the catalog.

#### Scenario: Schema
- **WHEN** the schema of `search_models` is read
- **THEN** the description of `category` says both
