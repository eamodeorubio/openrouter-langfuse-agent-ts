# Tasks

Pull request: `chore/upgrade-dependencies`, before `fix-retired-benchmark-indexes`. Commit type `fix:`, bump patch.

## 1. Slice: make category searches work (`fix:`)

- [x] 1.1 Write a failing integration test: a search with `category` and `supported_parameters` sends the query of What the API receives and returns the filtered page. Verify it fails for that reason
- [x] 1.2 Write failing example and property tests for the request rewrite (Category requests, Without a category), then add it to the client. Verify they pass
- [x] 1.3 Write failing tests for Required parameters, A page, Past the end and Price sort, then filter and page in the tool. Verify they pass
- [x] 1.4 Write a failing test for Next page offered, then refuse it. Verify it passes
- [x] 1.5 Write a failing test for the category description, then change it. Verify it passes
- [x] 1.6 Update `docs/src/content/docs/tools.md` with the beautiful-prose skill. Verify `pnpm docs:build`
- [x] 1.7 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation`. Verify all pass
- [x] 1.8 Run the three reviewers and fix every must-fix finding
- [x] 1.9 Write the full report, wait for approval, then commit

## Workflow follow-up

- Next slice: `fix-retired-benchmark-indexes`.
- Verify the change, then `chore: archive fix-category-search`.
