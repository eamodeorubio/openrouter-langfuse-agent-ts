# Proposal

## Why

The first full run of the evals, against `ask-openrouter@1.1.0`, failed 36 of Haiku's 210 runs. Opening them showed that 18 were answers the checks judged wrongly: nine for prices the answer gave for other models, five for a typo that Haiku did recover from, and four for a router whose missing price the answer did state. Two more failed a second check for naming a model that tied the first search result. The pass rates of that run, and so any comparison of models, are off by that much. A model cannot be chosen on figures that punish correct answers.

## What Changes

- The check for a model that does not exist fails only on a price stated for that model, not on any price in the answer.
- The check for a misspelled model counts a read of the correction in the same round as the failed lookup, since the model sent both calls at once.
- The check for a model with no price accepts the wordings `no published per-token price`, `does not list a per-token price` and `doesn't publish a fixed price`.
- The check on the top of a search accepts any model that ties the first listed on input and output price.
- The check for no match accepts `no single model` and `no one model`.
- No other check changes. The slug `anthropic/claude-haiku-latest`, which drops the `~` of the catalog's `~anthropic/claude-haiku-latest`, stays an invented slug: the CLI would send it to OpenRouter as written.

The change is of type `test:`: the evals are test tooling and part of no release of the CLI. It bumps nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-checks`: the requirements for recovery from a misspelled model, a model that does not exist, search efficiency and no match change. A new requirement states what counts as saying that a model has no price.

## Impact

- `packages/evals/src/checks/`: `discipline.ts`, `modelPrices.ts` and `searchChecks.ts`, which also holds the no-match list.
- `packages/evals/test/`: the tests of those checks.
- `docs/src/content/docs/evals.md` and the package README, which say what the checks accept. The results page of 1.1.0, on its own branch, is revised in a later change, once the run is repeated with these checks.
- The run of 1.1.0 is not rerun. Its zip keeps the verdicts the old checks gave.
