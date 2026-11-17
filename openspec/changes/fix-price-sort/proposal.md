## Why

The agent trusts the `sort` argument of `search_models`, and its `pricing-low-to-high` value does not do what the model assumes. OpenRouter orders by the average of input and output price, so the first row is not the cheapest on either side. In the full eval run, `search/cheapest-input` passed 0 of 10 runs on one model and 1 of 10 on the other: both took `inclusionai/ling-3.0-tiny` (0.015 input) and missed `z-ai/glm-5.2` (0.007 input, 6.8 output). The instructions and the tool descriptions tell the model to prefer the server sort, so the model did as told.

## What Changes

- `search_models` sorts by price on the tool side. The `sort` argument gains `input-price-low-to-high`, `input-price-high-to-low`, `output-price-low-to-high`, `output-price-high-to-low`, `blended-price-low-to-high` and `blended-price-high-to-low`.
- **BREAKING** (tool arguments only): `pricing-low-to-high` and `pricing-high-to-low` leave the `sort` enum. The other API sorts stay as they are.
- A new argument `input_per_output` sets the mix of a blended sort, in input tokens per output token. The default is 3.
- A new argument `paid_only` drops models that cost nothing or have no price. It works with a price sort.
- The tool fetches every match of the API filters once per run, keeps it in memory, and serves later price-sorted pages from it.
- The descriptions of the four price bounds say they are bounds. `min_prompt_price` no longer reads as "the lowest price".
- The case `search/single-search` asks for `blended-price-low-to-high`, where it asked for `pricing-low-to-high`.
- The instructions do not change. They already say to use the sort order a tool offers, which is now true of every sort the tool offers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: `search_models` gains tool-side price sorts, `input_per_output`, `paid_only` and the run cache; loses two API sort values; the result order and `total` follow the sort.

## Impact

- `packages/cli/src/tools/searchModels.ts`, plus a new module for the catalog cache and the sort.
- `packages/cli/test/`: `searchModels.test.ts`, `search.integration.test.ts`, and new tests for the sort.
- `packages/evals/cases/search.yaml`: one case.
- `docs/src/content/docs/tools.md` and `json-output.mdx`: the examples that name `pricing-low-to-high`.
- A price-sorted call costs one request per page of matches the first time, then none. A run that never sorts by price makes the same requests as today.
