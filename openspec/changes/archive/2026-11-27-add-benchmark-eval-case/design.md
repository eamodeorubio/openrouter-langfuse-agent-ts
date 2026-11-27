# Design

## Context

The snapshot keeps prices, context, parameters and modalities. The checks `wrong-search` and `wrong-answer` already compare a run with the slugs of any query. Today `search_models` cannot rank by the legal score, so the agent would have to read models one at a time.

## Goals / Non-Goals

**Goals:**

- A case that the current CLI is expected to fail and the ranking change should let it pass.

**Non-Goals:**

- A place in the core set or the gate: the case has no baseline yet.
- A check of the score the answer quotes.
- A paid run. The maintainer starts one.

## Decisions

**Name the benchmark in the question.** "Best for legal work" has many defensible answers. "Highest legal benchmark score" has one the catalog can check.

**Legal, one of the new indexes.** The coding index is retired and the intelligence index can be ranked today. A new index measures what the ranking change adds.

**Ties within 1%.** The same rule as the price queries, so `:batch` variants of the winner pass.

**No required search arguments.** Any route that surfaces the winner is a good run.

**Scores are optional in a snapshot.** Saved runs must still be judged again.

## Risks / Trade-offs

- [The API drops the score, the query returns nothing and the case passes] → The same rule holds for every query with no answer. The report of a run shows the snapshot, and a task checks the live catalog holds the score.
- [A model answers from memory] → `memory-answer` fails it.
