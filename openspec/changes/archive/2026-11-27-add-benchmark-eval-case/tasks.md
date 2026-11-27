# Tasks

Pull request: `chore/upgrade-dependencies`, before the `fix:` and `feat:` slices. Commit type `test:`, no bump.

## 1. Benchmark case (`test:`)

- [x] 1.1 Write failing tests for Scores kept and Older snapshot, then keep the scores. Verify the snapshot tests pass
- [x] 1.2 Write failing example and property tests for Highest benchmark score, then add `top-index`. Verify the query tests pass
- [x] 1.3 Write failing tests for the case table (`config.test.ts`), then add `search/best-legal`. Verify they pass
- [x] 1.4 Update the README of the evals and `docs/src/content/docs/evals.md` with the beautiful-prose skill. Verify `pnpm docs:build`
- [x] 1.5 Confirm on the public catalog that models carry `legal_index`
- [x] 1.6 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation:evals`. Verify all pass
- [x] 1.7 Run `reviewer-code-low` and `reviewer-docs`, and fix every must-fix finding
- [x] 1.8 Write the short report, wait for approval, then commit

## Workflow follow-up

- Verify the change, then `chore: archive add-benchmark-eval-case`.
