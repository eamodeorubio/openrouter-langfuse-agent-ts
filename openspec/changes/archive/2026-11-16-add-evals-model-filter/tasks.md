# Tasks

## 1. Choosing the models of a run (product slice 1)

Commit type `test:`, as `test: add the evals package (#46)` was: the evals are test tooling and no part of the CLI, so no commit of this pull request may bump the version of `packages/cli`. Branch `ci/evals-workflow`, shared with the workflow commit. Bump: none. The pull request title is `test: add a manual evals workflow with a model filter`; it must not be `feat:` or `fix:`. The process stays that of new behavior (spec, failing test first, all three reviewers, mutation run). Wait for the approval of the spec before any code.

- [x] 1.1 Write the failing integration test in `packages/evals/test`, through promptfoo against the loopback fake provider and the loopback catalog. A run with `--model anthropic/claude-haiku-5.5` starts no case of the other model and writes a report of one block. A run without the flag asks both. A run with an unknown id exits 3, names the id and the config's models, and the fake server sees no request, the catalog fetch included. Covers Choosing the models of a run, Unknown models are refused. Verify it fails because the flag is unknown.
- [x] 1.2 Write the failing unit tests in `runner.test.ts`: `parseRunArgs` reads `--model`, keeps it as written, refuses a missing value, and `run` hands it to promptfoo as `EVAL_MODELS_FILTER` only when it is set, and drops a filter left in the shell when it is not. Add a property test: whatever text follows `--model`, `parseRunArgs` keeps it as written. Covers Choosing the models of a run. Then add the flag, the option and the usage line to `runner.ts`. Verify they pass.
- [x] 1.3 Write the failing unit tests in `hooks.test.ts` for the narrowing: the suite returned holds the config's models that the filter names, each once, in the order of the config; every other field of the suite is the one received; the hook returns nothing when there is no filter. Add a property test: for any list of ids drawn from the config's models, with repeats and any order, the result is a subsequence of the config's list without duplicates. Covers Choosing the models of a run. Then add the narrowing and the returned suite to `hooks.ts`. Verify they pass.
- [x] 1.4 Write the failing tests in `hooks.test.ts` for the refusal: an id outside the list, the same id in another case, the same id with a trailing space, an empty id and the empty string each give a `SetupError` that names the id and lists the config's models, and the setup makes no call to `warm`, `snapshot` or `instructions` first. Covers Unknown models are refused. Then add the check at the head of `setup`. Verify they pass and that the exit code is 3.
- [x] 1.5 Write the failing tests for the placeholders: with the filter on the paid model, `EVAL_MODELS` holds that model alone and the `{free_model}` pick may be the free model of the config; with no filter it holds both. Covers Placeholders avoid the models of the run. Then set `EVAL_MODELS` from the narrowed list. Verify they pass.
- [x] 1.6 Write the failing tests for the target: a narrowed run writes `local build (...), models: <ids>` and `ask-openrouter@<version>, models: <ids>`, and a run without the flag writes the text it wrote before, byte for byte, checked against the existing expectation. Covers The target names the models. Then extend `describeTarget` in `hooks.ts`. Verify they pass and the first line of the report carries the models.
- [x] 1.7 Add the `model` input to `.github/workflows/evals.yml`: a string, empty by default, passed through `env:` and added as `--model` only when set. Verify the file with `pnpm check`, and that the step builds no argument for an empty value by reading the script.
- [x] 1.8 Update `packages/evals/README.md` (the flag next to `--repeat`, the `model` row of the input table, and the A/A use) and `docs/src/content/docs/evals.md`. Use the `beautiful-prose` skill with the settings of AGENTS.md. Verify with `pnpm docs:build` and that the commands shown parse with the runner.
- [x] 1.9 Refactor only where `QUALITY_RUBRIC.md` calls for it, at most 3 passes. Name the criterion for each.
- [x] 1.10 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation:evals`. The score stays at or above the `break` threshold. Read every survivor.
- [x] 1.11 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.12 Write the full report. Wait for user approval, which also approves the commit. Commit. No commit on a weekday from 9:00 to 18:00 Berlin time.

## 2. Archive

- [x] 2.1 Verify the change with `/opsx:verify` and fix what it finds.
- [x] 2.2 Once the user approves, archive it as `chore: archive add-evals-model-filter`, as the last commit before merge.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked every time. Never merge.
