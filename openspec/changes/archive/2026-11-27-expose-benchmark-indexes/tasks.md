# Tasks

Pull request: `fix/retired-benchmark-indexes`, after the fix slice. The title becomes a `feat:`, bump minor.

## 1. Slice: rank and explain the benchmark indexes (`feat:`)

- [x] 1.1 Write a failing integration test: a search sorted by `legal-high-to-low` sends that sort and shows `legal_index` (Index sorts, The ranking value is shown). Verify it fails for that reason
- [x] 1.2 Write failing tests for the shared index list and the descriptions (Benchmark indexes are explained), then add the list and build the descriptions from it. Verify they pass
- [x] 1.3 Write failing tests for the nine sorts, the refused decision sort and the extra entry field, then add them. Verify they pass
- [x] 1.4 Write failing tests for Unscored indexes and No score at all, then filter `get_model`. Verify they pass
- [x] 1.5 Update `docs/src/content/docs/tools.md` with the beautiful-prose skill. Verify `pnpm docs:build`
- [x] 1.6 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation`. Verify all pass
- [x] 1.7 Run the three reviewers and fix every must-fix finding
- [x] 1.8 Write the full report with the added description size, wait for approval, then commit

## Workflow follow-up

- Verify the change, then `chore: archive expose-benchmark-indexes`.
