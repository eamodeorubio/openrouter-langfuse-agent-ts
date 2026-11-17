# Tasks

One product slice: tool-side price sorts. Commit `feat:`. Pull request title `feat: sort model searches by price on the tool side`. Bump: minor. Reviewers: all three.

If the slice outgrows a human review, split it after task 2 (sorts and options) and before task 3 (the cache), and say so before going on.

## 1. Product slice: price sorts in `search_models`

- [x] 1.1 Write the failing integration test in `search.integration.test.ts`: a nock API with `a/x`, `b/y`, `c/z` (the first scenario of "Price sorts"), a call with `input-price-low-to-high`, and the result order `b/y`, `a/x`, `c/z`. Covers: Price sorts.
- [x] 1.2 Write failing unit tests for argument validation in `searchModels.test.ts`: removed sorts, `input_per_output` and `paid_only` with and without a price sort, `input_per_output` of 0 and -1. Covers: search_models arguments.
- [x] 1.2a Write failing tests for the exact error messages of the table in "Argument errors tell the model what to send", through the registry, so that the path and text reach the model as it reads them. Covers: Argument errors tell the model what to send.
- [x] 1.2b Write failing tests on the JSON schema offered to the model: every argument has a description; every value of the `sort` enum appears in the description of `sort` (a property over the enum, so a new value without a line fails); `input_per_output` and `paid_only` name the sorts they need; each price bound names input or output, the unit and the inclusive bound; `limit` and `offset` give range, default and `next_offset`. Covers: Arguments describe themselves.
- [x] 1.3 Write failing property tests with `fast-check` for the sort: the output is a permutation of the input; prices never decrease along `low-to-high` and never increase along `high-to-low`; a model with a `null` price is last; equal prices come in `id` order; the blended price of a mix lies between the input price and the output price. Covers: Price sorts.
- [x] 1.4 Write failing example tests: the blended scenario, the missing-price and tie scenario, and `paid_only` on 262 matches with 17 free and 8 unpriced (`total` 237). Covers: Price sorts, Paid only.
- [x] 1.5 Write failing tests for the cache: a second page and a second sort make no request; other filters do; a failure on page two is not kept; 6 pages of 1000 return the narrow-the-filters message; an API sort fetches one page and keeps nothing. Covers: Price sorts use one fetch per filter set.
- [x] 1.6 Implement the sort and the options: the `sort` enum, `input_per_output`, `paid_only`, the cross-argument checks with clear messages, the descriptions of every argument and of the tool, as the design drafts them.
- [x] 1.7 Implement the cache in its own module, keyed by the API filters, held by the tool context for the run, and wire the price sorts to it.
- [x] 1.8 Move `search/single-search` in `packages/evals/cases/search.yaml` to `blended-price-low-to-high`, and update the tests of `packages/evals` that name `pricing-low-to-high` only where the case file feeds them.
- [x] 1.9 Update the examples that name `pricing-low-to-high` in `docs/src/content/docs/tools.md` and `json-output.mdx`, and describe the price sorts, `input_per_output` and `paid_only` on the tools page. Check the sample `tool:` line in the `agent-loop` spec and the README for the same value.
- [x] 1.10 Check the instructions test still passes unchanged, and that no instruction names a tool.
- [x] 1.11 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation` and read every survivor. Run `pnpm mutation:evals` if `packages/evals/src/` changed.
- [x] 1.12 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.13 Skipped on the user's decision: the single-case run of `search/cheapest-input` was blocked in the session, and the user runs the core set against the pull request instead.
- [x] 1.14 Run the core set once as a smoke check (`--set core --repeat 1`, both models; read the usage in `packages/evals/README.md` first). The user asked for this run, which costs money. Report each case that fails and whether the failure is new, by comparing with the full run in `evals-full-44034078224`. `search/cheapest-input` is not in the core set, so task 1.13 stays.
- [ ] 1.15 Write the full report. Wait for the user's approval, which also approves the commit. Commit.

## 2. Archive

- [ ] 2.1 Run `/opsx:verify` on `fix-price-sort`, and fix what it finds.
- [ ] 2.2 Archive the change as its own commit, `chore: archive fix-price-sort`, once the user has approved it.
