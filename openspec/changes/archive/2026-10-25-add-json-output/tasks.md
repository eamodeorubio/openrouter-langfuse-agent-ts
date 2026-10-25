# Tasks

## 1. JSON output (product slice 1)

Commit type `feat:`. PR title `feat: add a --json flag for machine-readable output`. Bump: minor.

- [x] 1.1 Write the failing integration test in `packages/cli/test/json.integration.test.ts`: success object, thinking and trace id, failure object on stderr with exit code, nothing streamed early, `--json --verbose` silent. Covers Success object, Failure object, One object, Nothing else. Verify it fails for the missing flag.
- [x] 1.2 Write the failing test in `args.test.ts` for `--json` parsed and listed in usage. Covers Json flag. Then add the option to `args.ts` and `USAGE`. Verify it passes.
- [x] 1.3 Write the failing unit tests for the error-to-code table, including a `TimeoutError`. Covers Error codes. Then add the mapping module and the subclass in `failures.ts`. Verify the tests pass.
- [x] 1.4 Write the failing unit tests for the collector: answer, thinking, trace id, partial answer on failure. Add a property test: the object parses as JSON for any text (Valid JSON for any text). Then add the collector. Verify they pass.
- [x] 1.5 Write the failing tests for flag errors and flush failure: `--json` with a bad flag combination gives `USAGE_ERROR`; a failed flush gives `TRACE_FLUSH_FAILED` and exit 2. Covers Flag errors still report as JSON, Lost trace. Then wire the collector, the failure routing and the silence into `cli.ts`. Verify the integration test from 1.1 now passes.
- [x] 1.6 Add Ajv as a dev dependency with pnpm. Write failing tests in `json.schema.test.ts`: the committed file equals the schema generated from the Zod schema (drift), its `$id` carries the `package.json` version, the accepted and rejected examples of the spec table hold against the file, and every object from the integration run validates. Covers Published JSON Schema. Then define the Zod schema (and use its type in the collector), add the `schema:generate` script, commit the generated `docs/public/schemas/json-output.schema.json`, and exclude it from the formatters. Verify the tests pass.
- [x] 1.6a Add the schema file to `release-please-config.json` as a `generic` extra file with the `x-release-please-version` marker on the `$id` line. Verify with a Release Please dry run, or a local run of its updater, that a version bump rewrites the `$id`. If it cannot, stop and ask.
- [x] 1.7 Write a failing test that a key echoed by an API error does not reach the object (Secrets stay out). Verify it passes once the message goes through `redactAll`.
- [x] 1.8 Refactor only where `QUALITY_RUBRIC.md` calls for it, at most 3 passes. Name the criterion for each.
- [x] 1.9 Document `--json` in `README.md` and `docs/src/content/docs/ask-a-question.md`, and add `docs/src/content/docs/json-output.mdx` with the fields, the error codes and the schema imported from the published file. Use the `beautiful-prose` skill with the settings of AGENTS.md. Verify with `pnpm docs:build`  that the page renders the schema, and that the example matches the integration test output.
- [x] 1.10 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm mutation`. The score stays at or above the `break` threshold. Read every survivor.
- [x] 1.11 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.12 Write the full report. Wait for user approval, which also approves the commit. Commit.

## 2. Model and usage in the JSON output (product slice 2)

Commit type `feat:`, on `feat/json-output`, in the open PR #26. The PR title stays `feat: add a --json flag for machine-readable output`. Bump: minor, unchanged.

- [x] 2.1 Update `json.integration.test.ts` so the success object holds `model` and `usage`: the plain-answer test compares the parsed object; a two-round run adds the counts and the cost; a run where one round has no cost has no `cost`; a failed run after a response has neither field. Covers Success object, Model and usage, Failure object without model and usage. Verify the tests fail for the missing fields.
- [x] 2.2 Write failing unit tests for `addUsage` in `usage.test.ts`: cached tokens are summed and absent when neither side has them, cost is summed and absent when either side lacks it, a reported zero is kept. Add a property test: for any list of usages, the counts are the sums, `cost` is present exactly when every usage has one, and the order does not change the result. Covers Model and usage. Then extend `addUsage` in `usage.ts`. Verify they pass.
- [x] 2.3 Make the sum in `ask.ts` start from a zero usage with a zero cost. Verify with a test through `ask` that two rounds with costs add up and that the first round's cost is not lost.
- [x] 2.4 Write failing tests in `collector.test.ts` and `output.test.ts`: `success()` holds the model and usage of the `done` event, `failure()` does not, optional usage fields are omitted when absent, and the schema rejects a success object without `model` or `usage` and a `usage` with an extra field, a negative count or a fractional count. Add the new examples to `outputExamples.ts`. Then add `model` and `usage` to the Zod schema and the collector. Verify they pass.
- [x] 2.5 Run `pnpm --filter openrouter-langfuse-agent-ts run schema:generate` and commit the regenerated file. Verify the drift test and the Ajv examples of `json.schema.test.ts` pass.
- [x] 2.6 Update `docs/src/content/docs/json-output.mdx`: the example, the field table, a section on `usage` that says when `cost` and the optional counts appear, and the line that told readers to look in the trace for model and tokens. Mention it in the README paragraph. Use the `beautiful-prose` skill with the settings of AGENTS.md. Verify with `pnpm docs:build` and that the example matches the integration test output.
- [x] 2.7 Refactor only where `QUALITY_RUBRIC.md` calls for it, at most 3 passes. Name the criterion for each.
- [x] 2.8 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation`. The score stays at or above the `break` threshold. Read every survivor.
- [x] 2.9 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 2.10 Write the full report. Wait for user approval, which also approves the commit. Commit.
- [ ] 2.11 Push to `feat/json-output`, which updates PR #26, only with the user's permission. Update the PR description with the user's permission. Never merge.

## 3. Archive

The change was archived once, for the first slice, before this amend. Archiving it again is the last commit before merge.

- [x] 3.1 Verify the change with `/opsx:verify` and fix what it finds.
- [x] 3.2 Once the user approves, archive it as `chore: archive add-json-output`, as the last commit before merge. The commit also moves the change back to `openspec/changes/archive/` and restores `openspec/specs/json-output/spec.md`, now with model and usage.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked every time. Never merge.
