# Tasks

Pull request: `fix/retired-benchmark-indexes`. The title is a `fix:`, bump patch, until the next slice joins it.

## 1. Slice: drop the retired benchmark indexes (`fix:`)

- [x] 1.1 Write a failing integration test in `search.integration.test.ts`: a search entry holds `intelligence_index` and neither retired field (search_models result). Verify it fails for that reason
- [x] 1.2 Write failing tests for the two retired sorts and the two retired floors (Retired benchmarks), then remove them from the schema, the filters, the entry and the descriptions. Verify `searchModels` tests pass
- [x] 1.3 Write a failing test in `getModel.test.ts` for Retired indexes, then drop both fields. Verify it passes
- [x] 1.4 Update `docs/src/content/docs/tools.md` with the beautiful-prose skill. Verify `pnpm docs:build`
- [x] 1.5 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation`. Verify all pass
- [x] 1.6 Run the three reviewers and fix every must-fix finding
- [x] 1.7 Write the full report, wait for approval, then commit

## Workflow follow-up

- Next slice: `expose-benchmark-indexes`.
- Verify the change, then `chore: archive fix-retired-benchmark-indexes`.
