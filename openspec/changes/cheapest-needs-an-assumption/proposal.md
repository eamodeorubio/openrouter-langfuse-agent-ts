## Why

"What is the cheapest model?" has no single answer. Models differ in how they split their price between input and output, so the cheapest to read is rarely the cheapest to write. Users ask it this way all the time, and nothing in the instructions says what to do with it.

The eval case `search/single-search` shows the cost. Haiku searched once by input price and once by output price, then answered with both. The answer was honest and useful. It also cost a second search, and the case marked it `wasteful-search` and `wrong-search`. Models that read "cheapest" as one price get the other half of the question wrong, and models that cover both spend a round.

## What Changes

- The system message gains one rule. A question about the cheapest model that says nothing about usage is ranked by a blend of input and output price, three input tokens for every output token unless the user says otherwise. The answer says which mix it assumed. When only one price matters, such as input for a long prompt, it ranks by that price alone.
- The rule names no catalog tool, as the instructions already do not.
- The description of `sort` in `search_models` says which sorts to use when the user gives no usage: the blended ones, with the default mix.
- No tool argument, result or sort value changes. No code path changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-loop`: the system message tells the model what to assume when a question about the cheapest model gives no usage, and to say so.
- `model-tools`: the description of `sort` names the blended sorts as the choice when no usage is given.

## Impact

- `packages/cli/src/instructions.ts`: one rule.
- `packages/cli/src/tools/searchModels.ts`: one sentence in the description of `sort`.
- `packages/cli/test/instructions.test.ts` and `packages/cli/test/searchModels.price.test.ts`: tests for both.
- The case `search/single-search` stays as it is. It is the measure of this change.
- Answers to "cheapest model" questions change: they state an assumed mix.
