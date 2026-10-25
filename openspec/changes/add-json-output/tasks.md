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

## 2. Archive

- [x] 2.1 Verify the change with `/opsx:verify` and fix what it finds.
- [ ] 2.2 Once the user approves, archive it as `chore: archive add-json-output`, as the last commit before merge.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked every time. Never merge.
