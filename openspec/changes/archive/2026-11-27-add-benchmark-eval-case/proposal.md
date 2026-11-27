# Proposal

## Why

No eval case asks about a benchmark. The change to the retired indexes and the change that ranks by the new ones would both merge with nothing to show whether answers got better or worse.

## What Changes

- The catalog snapshot keeps each model's Artificial Analysis scores.
- A new oracle query, `top-index`, returns the models with the highest score of one index.
- A new case, `search/best-legal`, asks which model has the highest legal benchmark score. It joins the `judge` and `full` sets.
- The README of the evals and the docs page list the case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-oracle`: the snapshot keeps scores, and a query ranks by one.
- `eval-checks`: the case table gains one case.

## Impact

- `packages/evals`: snapshot, queries, `cases/search.yaml`, tests and README; `docs/src/content/docs/evals.md`.
- A `test:` change, which releases nothing. The core set and the gate floors stay as they are.
- A full or judge run costs a little more: one more case.
