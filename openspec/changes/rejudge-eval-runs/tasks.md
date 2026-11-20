# Tasks

One slice of chore work: the re-judge command. Commit `test:`, as the user called it. No bump. Reviewers: `reviewer-code-low`, and `reviewer-docs` because the slice changes docs. It ships in one pull request with `paid-only-hint-and-text-booleans`, whose `fix:` sets the bump; the pull request title is in that change.

## 1. Chore: the `rejudge` command

- [x] 1.1 Download both baselines with `gh run download 44247364171` and `gh run download 44691387152` into the scratchpad. Build fixtures shaped on the real rows by builders (`test/rejudgeFixture.ts`: a passing row, a failing row, a provider error, a row with a rubric, a catalog and instructions beside it), not by copying rows, which weigh 13 MB a file. Verify: the existing `readRuns` and `report` read the fixtures, and the real files are the acceptance of 1.5.
- [x] 1.2 Write the failing integration test over the fixture directory: run the command; `rejudged/` appears; the report reads it; the flips are printed. Covers: Re-judging a saved run, The re-judged file is a results file, Flips are printed.
- [x] 1.3 Write the failing unit tests, one piece at a time, then the code:
  - config reader: cases and `defaultTest` assertions in order, `file://…:name` resolved, other values refused. Covers: Each run is judged against its own snapshot, the error table.
  - environment: `EVAL_CATALOG` and `EVAL_INSTRUCTIONS` set and restored; two directories stay apart.
  - judging: a row's `javascript` components replaced, rubrics kept, provider errors copied; added and removed metrics are flips with `absent`.
  - row rebuild: `success`, `failureReason`, scores, `namedScores`, `stats`. Property: re-judging with unchanged verdicts returns every row's `success` and `score`; re-judging twice prints 0 flips and gives an equal file (idempotence). Property: the command never throws on any results shape, and refuses with exit 1 or 2.
  - flip lines: format, order by case, model, repeat; closing line; the plural.
  - errors: each row of the error table, and `rejudged/` absent after each.
  - offline: the command runs under `test/setup.ts` with no request.
- [x] 1.4 Add the `rejudge` script to `packages/evals/package.json` and `src/rejudge/main.ts` as thin wiring. Add `!src/rejudge/main.ts` to `mutate` in `packages/evals/stryker.config.json`, next to `src/report/main.ts`. Verify: `pnpm --filter ask-openrouter-evals run rejudge` without an argument exits 2 with the usage.
- [x] 1.5 Acceptance on the real baselines, run by hand on the downloaded files, which needs no key and no request:
  - `rejudge` of `44691387152` with the checks of this branch prints 0 flips, and its `success` and `score` equal the saved ones.
  - `rejudge` of `44247364171` prints its flips. Record the output in the report, and the flips by model, case and check. Write no count into any spec.
  - `report` reads both `rejudged/results.json` files.
  If the first prints a flip, or the identity of `score` fails, stop and tell the user.
- [x] 1.6 Document the command in `docs/src/content/docs/evals.md` and `packages/evals/README.md`: what it does, what it does not (no rubric, no model call), where the output goes, how to read a flip. Verify: `docs.test.ts` passes and the documented command runs as written on the fixture.
- [x] 1.7 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation:evals`; the score stays at or above the `break` threshold. Read every survivor; kill it with a test, or rewrite the code, or disable it with a reason.
- [x] 1.8 Run `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [ ] 1.9 Write the short report, with the printed flips of 1.5. Wait for the user's approval, which also approves the commit. Commit `test: re-judge a saved eval run with the current checks`.

## 2. Archive

- [ ] 2.1 Run `/opsx:verify` on `rejudge-eval-runs` and fix what it finds.
- [ ] 2.2 Archive as its own commit, `chore: archive rejudge-eval-runs`, once the user has approved it. It is the last commit before merge.

## Workflow follow-up

- The next slice is in `paid-only-hint-and-text-booleans`. It starts after the user approves slice 1.
- After the pull request merges, the user re-judges the two baselines with the checks on `main`. Step 1 of the verification in `paid-only-hint-and-text-booleans` is this.
