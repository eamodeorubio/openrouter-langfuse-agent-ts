# Proposal

## Why

A traced run holds several generations. In two real runs of the tool there were three and seven, one for each round of tool calls and one for the answer. Only the last one is the text the user got. Anyone who filters a Langfuse project for the answers, whether a person in the tracing table or an evaluator that scores them, has to walk each tree to find it. The model thinks aloud in the middle rounds too, so the answer cannot be told from the other generations by its name, its type or its position in a filter.

## What Changes

- Every `generation` carries a boolean `final_answer` in its metadata. It is `true` on the generation whose response held answer text and no tool calls, which is the text the CLI writes as the answer. It is `false` on every other generation, so a filter works on either value.
- A run that is answered has exactly one `true`. A run that fails before an answer has none.
- The usage guide says what the flag marks and how to filter on it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trace-content`: a new requirement, *Final answer flag*. Nothing that exists changes.

## Impact

- `packages/cli/src`: `GenerationResult` gains a boolean that `ask.ts` sets where it builds the outcome of a round, and `tracing/langfuse.ts` writes it into the metadata next to `finish_reason` and `retries`.
- The usage guide, a new section "Which generation is the answer".
- No new dependency, setting or exit code.
- The `trace-content` main spec exists only on the branch of pull request #23, where it was archived. This change is stacked on that branch and waits for the merge.
- Bump: minor (`feat:`).
