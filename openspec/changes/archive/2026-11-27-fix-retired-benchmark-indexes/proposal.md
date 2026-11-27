# Proposal

## Why

Artificial Analysis has retired its Coding and Agentic indexes. The public catalog, read on 2026-11-27, holds a null for both on all 219 models that carry its scores. `search_models` still offers them. A sort by either returns models in slug order, and a floor on either matches nothing. An agent asked for the best coding model gets an alphabetical list and may present it as a ranking.

## What Changes

- Remove the sorts `coding-high-to-low` and `agentic-high-to-low` from `search_models`.
- Remove the arguments `min_coding_index` and `min_agentic_index`.
- Remove `coding_index` and `agentic_index` from `search_models` entries and from `get_model` benchmarks.
- Update the tool descriptions and `docs/src/content/docs/tools.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: arguments, results and argument errors lose the two retired indexes.

## Impact

- `packages/cli/src/tools/searchModels.ts`, `packages/cli/src/tools/getModel.ts`, their tests and fixtures.
- The tool schema offered to the model shrinks. The command line is unchanged.
- A `fix:`, so a patch release. The eval gate runs on the pull request.
