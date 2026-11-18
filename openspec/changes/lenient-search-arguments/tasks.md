# Tasks

One product slice: lenient arguments. Commit `fix:`, as the user called it. Pull request title `fix: accept numbers and booleans sent as text in search_models`. Bump: patch. Reviewers: all three. The evals checks go in a `test:` commit beside it, with `reviewer-code-low`.

The code of both parts exists already, written test first before this spec. The tasks record it and name what remains.

## 1. Product slice: text for numbers and booleans in `search_models`

- [x] 1.1 Write failing tests in `searchModels.text.test.ts`: every numeric argument reads its text; every out-of-range number and text fails the same way; refused texts (`""`, `"abc"`, `"0x10"`, `"Infinity"`, `"1e999"`); a number and its text agree (property); a page of text numbers (property); never throws (property); the API gets the number; `"false"` sends no `zdr`. Covers: Numbers and booleans may be sent as text.
- [x] 1.2 Write failing tests for the exact messages of the new rows of "Argument errors tell the model what to send", through the registry. Covers: Argument errors tell the model what to send.
- [x] 1.3 Write failing tests on the JSON schema: each numeric argument offers `number` and `string`, each boolean offers `boolean` and `string`, and each description says so. Covers: Arguments describe themselves.
- [x] 1.4 Implement `flag`, `numeric` and the number-text reader in `lenientArgs.ts`; use them for every numeric and boolean argument of `search_models`; reword the descriptions.
- [x] 1.5 Add the paragraph on text values to `docs/src/content/docs/tools.md`, and the two clauses on text numbers and paid questions to the `wrong-search` and `wrong-answer` rows of `docs/src/content/docs/evals.md`.
- [x] 1.6 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation` and read every survivor.
- [ ] 1.7 Rerun `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs` on the whole diff, with this spec in hand. Fix every must-fix finding.
- [ ] 1.8 Write the full report. Wait for the user's approval, which also approves the commit. Commit.

## 2. Chore: evals checks follow the tool

- [x] 2.1 Write failing tests for the cases of "Search checks" (a number sent as text, a number and its text) in `search.test.ts`, and for "Search efficiency" (a paid question skips unpaid models, what is paid, a question that does not ask for a paid model) in `misfires.test.ts`.
- [x] 2.2 Implement `numberOf` in `json.ts` and use it in `carries`; skip unpaid models in `topOfSearch` for a question that asks for a paid model.
- [x] 2.3 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation:evals`; read every survivor.
- [x] 2.4 Run the core set once with Nemotron (`--repeat 1`), at the user's request. All 11 cases passed. Before the checks followed the tool, 3 failed `wrong-search`.
- [ ] 2.5 Run `reviewer-code-low` on the evals diff. Fix every must-fix finding.
- [ ] 2.6 Write the short report. Wait for the user's approval, which also approves the commit. Commit `test: read numeric text and paid questions in the search checks`.

## 3. Archive

- [ ] 3.1 Run `/opsx:verify` on `lenient-search-arguments`, and fix what it finds.
- [ ] 3.2 Archive the change as its own commit, `chore: archive lenient-search-arguments`, once the user has approved it.
