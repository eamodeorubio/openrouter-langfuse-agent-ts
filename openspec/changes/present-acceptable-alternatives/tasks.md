# Tasks

One product slice: the check for acceptable alternatives and its case. It changes the evals only. Commit `test:`. Pull request title `test: add a check for acceptable alternatives and a case for it`, bump none. Reviewers: `reviewer-code-low`, as the table says for tests only, and `reviewer-docs` for the docs it touches.

## 1. Slice: the query, the check and the case

- [x] 1.1 Write the failing integration tests: in `config.test.ts`, `search/alternatives` is in the core set and declares its three groups and the minimum 2; in `alternatives.test.ts`, the case as `cases/search.yaml` declares it fails an answer of free models only and passes one that adds a paid model. Covers: Cases and sets, Free and paid, One group only.
- [x] 1.2 Write the failing unit tests for the oracle query `free` on the worked table of the spec, including the empty result and a model with a `null` price. Covers: Free models.
- [x] 1.3 Write the failing unit and property tests for the check: it passes when the answer reaches the minimum; it fails otherwise and names the groups missed; an empty group is left out and the minimum falls; the check never throws on any answer; naming more slugs never turns a pass into a fail; a run left to `wrong-search` passes this check. Covers: Acceptable alternatives (all its scenarios).
- [x] 1.4 Write the failing tests for the declaration: no groups, a minimum below 1, and an unknown query each fail loading with the declaration named. Covers: Unknown or malformed declaration.
- [x] 1.5 Implement the `free` query in `queries.ts` and make 1.2 pass.
- [x] 1.6 Implement the declaration in `caseSpec.ts` and the check in `searchChecks.ts`, register `missing-alternative` after `wrong-answer` in the taxonomy and in `assertions.ts`, and make 1.3 and 1.4 pass.
- [x] 1.7 Add the case `search/alternatives` to `cases/search.yaml` in the core, judge and full sets, with the filters `min_context_length` 200000 and `supported_parameters` `tools`, and make 1.1 pass.
- [x] 1.8 Update `packages/evals/README.md` and `docs/src/content/docs/evals.md`: the class, the case and the counts (eleven cases become twelve). Check that no doc contradicts the new counts.
- [x] 1.9 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation:evals` on the changed files and read every survivor. Kill each with a better test, often a property test.
- [x] 1.10 Run `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [ ] 1.11 Run the new case once on Haiku locally, `--set judge` with the case filter the runner offers, or the user runs it in GitHub on the branch with `model=anthropic/claude-haiku-5.5` at `repeat` 10. Read how often the answer reaches two groups, and report it as evidence about free and paid answers.
- [x] 1.12 Write the short report. Wait for the user's approval, which also approves the commit. Commit. Push and open a pull request only with the user's permission.

## 2. Archive

- [ ] 2.1 Run `/opsx:verify` on `present-acceptable-alternatives`, and fix what it finds.
- [ ] 2.2 Archive the change as its own commit, `chore: archive present-acceptable-alternatives`, once the user has approved it.
