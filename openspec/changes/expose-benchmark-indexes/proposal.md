# Proposal

## Why

The catalog scores models on nine fields of work and traits beyond general intelligence, such as law, finance, engineering and multilingual skill. `get_model` already passes these numbers on since the SDK upgrade, with no word on what they mean. One runs from 0 to 1 and the rest from 0 to 100. `search_models` cannot rank by any of them, so the agent cannot answer "the cheapest strong model for legal work" from the catalog.

## What Changes

- `get_model` returns only the indexes that have a score.
- The `get_model` description explains each index: meaning, scale, and what a missing score means.
- `search_models` gains nine sorts, one per new index except the decision index.
- A search sorted by one of them shows that score in each entry.
- Update `docs/src/content/docs/tools.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: new sorts, the result of `get_model` and `search_models`, and how indexes are explained.

## Impact

- `packages/cli/src/tools/`: `searchModels.ts`, `getModel.ts` and a shared list of indexes.
- Longer tool descriptions travel with every request, so prompt tokens rise.
- A `feat:`, so a minor release. It follows `fix-retired-benchmark-indexes`.
