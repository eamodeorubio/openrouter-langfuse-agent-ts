# Tasks

## 1. The harness end to end (product slice 1)

Commit type `test:`. PR title `test: add the evals package`. Bump: none. Branch `evals`. Slice 1 runs case A1 on the two models, with the universal checks, and reports pass@k and pass^k. The live run happens only when the user asks.

- [x] 1.1 Run the offline spike with a stub CLI and a loopback server, in the scratchpad and not in the repository. Answer the facts listed under Risks in `design.md`: the shape of `results.json`, errors, repeats and weight-0 records; cache under `--repeat`; transform order; the Jev path and model slug; the key in saved results; judge state size. Write each answer into `design.md` with its fallback if it fails, and amend any spec a finding contradicts. Verify every listed fact has a recorded answer and `openspec validate add-evals-package` passes.
- [x] 1.2 Scaffold `packages/evals`: `package.json` with `test`, `typecheck`, `eval`, `eval:full` and `report`, a tsconfig, a vitest config whose setup refuses every request except to the loopback interface, `results/` in `.gitignore`, and the dependencies (`promptfoo`, `fast-check`, `vitest` and `@vitest/coverage-v8` at the CLI's pinned versions). Covers Evals stay out of the offline suite. Verify `pnpm install --frozen-lockfile` is clean, `pnpm typecheck` passes, and a throwaway test that requests a public host fails with the refusal.
- [x] 1.3 Write the failing integration test in `packages/evals/test/harness.integration.test.ts`. It drives promptfoo, with telemetry off, over a stub CLI that prints canned `--json` output per scenario, with `--repeat 3` and no cache, then runs the reporter on the saved file. Scenarios: all pass; a check fails; the stub exits 1; the stub prints non-JSON; `vars.model` missing; `dist/index.js` missing. Covers The provider runs the built CLI, Outcomes of a CLI run, The build must exist, Repeats without cache, Cells, Input and output. Verify it fails for the missing code.
- [x] 1.4 Write the failing tests in `test/estimators.test.ts`: every row of the estimator table, and `fast-check` properties for the range, the bounds against c/n, monotonicity in k, `k = 1` equal to c/n, `c = 0` and `c = n`, equality with the binomial form on small inputs, and the error for k or c above n. Covers Estimators, Estimator invariants. Then write `src/report/estimators.ts` with the product form. Verify the tests pass.
- [x] 1.5 Write the failing tests in `test/provider.test.ts` against a loopback stub: the model comes from `vars.model` only, a question with quotes and `$(id)` arrives unchanged, each row of the outcome table, cost and tokens mapped and cost left out when absent, the timeout. Covers The provider runs the built CLI, The model comes from the case, Outcomes of a CLI run, Cost and tokens. Then write `src/provider/`. Verify the tests pass.
- [x] 1.6 Write the failing tests in `test/report.test.ts`: cells from a fixture file with errors counted as not passed, model rows as the mean of cells, failures by class, the informational figures including `n/a` and `-`, a missing or malformed file giving a non-zero exit, and a failing cell giving exit 0. Add a property test: the report never throws on a well-formed file with any mix of runs. Covers Cells, Model rows, Failures by class, Informational figures, Input and output. Then write `src/report/`, which already reads the judge scores and computes the judge pass rate, so that the report spec is whole before the rubrics arrive in slice 3. Verify the tests pass.
- [x] 1.7 Write the failing tests for the checks in `test/slugs.test.ts`, `test/figures.test.ts` and `test/checks.test.ts`: each row of the invented-models and asked-figures tables; a property test that extraction and matching never throw on any string; precedence on a run with no lookup, a failed run and a blank answer; the pass rule with a weight-0 check. Covers Error classes, Precedence, Pass, Run failed, Memory answer, Invented models, Asked figures. Then write `src/checks/` and the inline checks. Verify the tests pass.
- [x] 1.8 Write `promptfooconfig.yaml` with the two models, case A1 and the universal checks. Write the failing config test first: two distinct slugs, none an alias, the script flags, the key absent from the file. Covers The model matrix, Repeats without cache, Cases and sets (A1, core run). Verify the test passes and the integration test from 1.3 passes.
- [x] 1.9 Add the dummy-key test to the integration test: a run with a dummy `OPENROUTER_API_KEY` leaves no file under `results/` that holds it. Covers The key stays in the environment, Results location. Verify it passes, or apply the fallback recorded in 1.1.
- [x] 1.10 Write `packages/evals/README.md` with how to build, set the key, run `eval`, run the reporter and read the table, using the `beautiful-prose` skill with the settings of `AGENTS.md`. Record the exception in `AGENTS.md`: evals call real services with the user's key and run only when the user asks. Point to the guide from `CONTRIBUTING.md`, because the root `README.md` is also the package's README on npm and speaks to users, not contributors. Verify each documented offline command runs as written and `pnpm check` passes.
- [x] 1.11 Add a Stryker config for `packages/evals` at the CLI's pinned concurrency, and extend the root `mutation` scripts. Run `pnpm mutation:evals`, which stays beside the root `pnpm mutation` because CI passes that one CLI paths. The score stays at or above the `break` threshold. Read every survivor and kill it with a better test, often a property test, or disable it with a reasoned comment.
- [x] 1.12 Refactor only where `QUALITY_RUBRIC.md` calls for it, at most 3 passes. Name the criterion for each.
- [x] 1.13 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Verify all pass.
- [x] 1.14 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.15 Write the full report. Wait for user approval, which also approves the commit. Commit.

## 2. Archive

- [ ] 2.1 After the last slice, verify the change with `/opsx:verify` and fix what it finds.
- [ ] 2.2 Once the user approves, archive it as `chore: archive add-evals-package`, as the last commit before merge.

## Workflow follow-up

- The next product slices are named here and planned when their turn comes. Each is a `test:` commit with no bump.
  - Slice 2: the oracle, case C1 and case B7, which completes the core set.
  - Slice 3: the judge rubrics at weight 0.
  - Slice 4: cases A3, A5, B2 and B3, which completes the full set.
- Push the branch and open the pull request only with the user's permission, asked every time. Never merge.
