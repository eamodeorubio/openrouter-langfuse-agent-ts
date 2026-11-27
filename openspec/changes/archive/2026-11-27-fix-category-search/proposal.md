# Proposal

## Why

Every `search_models` call with `category` fails. The catalog API refuses `category` beside `offset` or `limit`, which the tool and the SDK always send, and beside `supported_parameters`. The API reference mentions neither rule. In an eval run on 2026-11-27 an agent tried the filter three times, got a 400 each time and fell back to a name search.

## What Changes

- A search with `category` reaches the API without `offset`, `limit` or `supported_parameters`.
- The tool applies `supported_parameters` and the page itself.
- The description of `category` says that it narrows the search to a short list.
- Update `docs/src/content/docs/tools.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: how a search with `category` is requested, filtered and paged.

## Impact

- `packages/cli/src/client.ts` and `packages/cli/src/tools/`.
- The arguments and the result of the tool keep their shape.
- A `fix:`, so a patch release. The eval gate runs on the pull request.
