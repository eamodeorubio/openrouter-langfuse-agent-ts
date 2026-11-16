# Tasks

## 1. Checks that stop punishing correct answers (product slice 1)

Commit type `test:`: the evals are test tooling and no part of the CLI, as in `test: add the evals package (#46)`. Branch `fix/eval-check-misfires`. Bump: none. The pull request title is `test: fix five misfires of the eval checks`; it must not be `feat:` or `fix:`. The process stays that of changed behavior of the checks: spec, failing test first, mutation run. Reviewers: `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Wait for the approval of the spec before any code.

- [x] 1.1 Write the failing integration test in `packages/evals/test`: the verdicts of the checks over four fixture runs taken from the 1.1.0 run (a Haiku `unknown-model` answer that lists other models' prices, a same-round typo recovery, a router answer that says "no published per-token price", a tie at the top of a search). Each passes. A fifth fixture for each of the same checks, built to fail rightly, still fails. Covers all five requirements. Verify it fails for the old rules.
- [x] 1.2 Write the failing tests in `disciplineChecks.test.ts` for `recovered`: both lookups in one round pass; the correction before the failure fails; a later round passes; no read fails. Add a property test: for any rounds, the check passes exactly when the latest read is not before the earliest failure. Covers Recovery from a misspelled model. Then change the comparison. Verify they pass.
- [x] 1.3 Write the failing tests for `noPriceForUnknown`: other models' prices pass; a price after the slug in the same sentence fails; a price beside another slug after the unknown one fails; a price in the next sentence passes; a table row with the slug and a price fails; the existing scenarios still hold. Add a property test: an answer with no dollar figure and no `per million` never fails. Covers A model that does not exist. Then read the window after each mention. Verify they pass.
- [x] 1.4 Write the failing tests for `saysNoFixedPrice`: the three wordings of the table in the spec pass; "it routes requests quickly" and "the price is $1" fail; each existing wording still passes. Add a property test: an answer with no price word never passes. Covers Saying that a model has no price. Then widen the patterns. Verify they pass.
- [x] 1.5 Write the failing tests for `topOfSearch`: a tie on both prices passes; a model with the same input price and another output price fails; a model the output does not list fails; the first listed passes. Add a property test: naming the first listed always passes. Covers Search efficiency. Then accept the ties. Verify they pass.
- [x] 1.6 Write the failing test for `phantomMatch`: "no single model" and "no one model" pass; "no, models differ" fails. Covers No match. Then extend the list. Verify they pass.
- [x] 1.7 Rerun the checks over `results.json` of 1.1.0 offline, with the reporter, and compare. The 18 misfires pass; the two ties still fail `wasteful-search`; no other verdict changes. Keep the comparison in the report. This costs nothing: no request leaves the machine.
- [x] 1.8 Update `docs/src/content/docs/evals.md`: the checks' wordings, in their sections. The note on the results page of 1.1.0, that its figures come from the checks before this change, goes in once that page is on `main`: it lives on branch `docs/evals-results-1-1-0`. Use the `beautiful-prose` skill with the settings of AGENTS.md. Verify with `pnpm docs:build`.
- [x] 1.9 Refactor only where `QUALITY_RUBRIC.md` calls for it, at most 3 passes. Name the criterion for each.
- [x] 1.10 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation:evals`. The score stays at or above the `break` threshold. Read every survivor.
- [x] 1.11 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.12 Write the full report. Wait for user approval, which also approves the commit. Commit. No commit on a weekday from 9:00 to 18:00 Berlin time.

## 2. Archive

- [x] 2.1 Verify the change with `/opsx:verify` and fix what it finds.
- [x] 2.2 Once the user approves, archive it as `chore: archive fix-eval-check-misfires`, as the last commit before merge.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked every time. Never merge.
