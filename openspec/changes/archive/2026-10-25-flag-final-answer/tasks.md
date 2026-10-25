# Tasks

One product slice: a `feat:`, minor. The pull request title is `feat: flag the answer the user gets in the trace`. Reviewers: all three. Full report.

This change is stacked on the branch of pull request #23. Nothing is pushed before that pull request merges and this branch is rebased onto `main`, unless the user decides otherwise.

## 1. Slice 1: `feat: flag the answer the user gets in the trace` (minor)

Spec: *Final answer flag*.

- [x] 1.1 Failing integration test through `run`, covers *Tool rounds, then the answer* and *Not elsewhere*: the local fake server answers two tool rounds and an answer, an in-memory exporter takes the spans. Assert that the three generations carry `false`, `false` and `true` in `langfuse.observation.metadata.final_answer`, that the `true` one holds the text of the root's output, and that no root, tool or event carries the key. Verify it fails because the key is absent.
- [x] 1.2 Failing unit tests, then code, for the tracer: a result with `final: true` writes `true` in the metadata of the generation and one with `final: false` writes `false`; a result without `final` and a failed one write `false`; `finish_reason`, `retries` and the counts that did not fit are still there. Covers *Cases* (the request failed) and *Failed run*.
- [x] 1.3 Failing unit tests, then code, for the loop, through `ask` with a recording tracer: each row of the *Cases* table (answer, text and a tool call, tool calls only, nothing, interrupted). Then one test through `run` for *Answer written, then the run fails*: a response without usage gives exit 2, `true` on that generation and no output on the root.
- [x] 1.4 Property test with `fast-check`, 20 runs: for any run of 0 to 8 tool rounds that ends in an answer, a refusal or an interrupt, at most one generation carries `true`, it is the last, and it is there exactly when the run was answered. Keep any counterexample as an example test.
- [x] 1.5 Add a section "Which generation is the answer" to the usage guide: what `final_answer` marks, that the others carry `false`, and how to filter on it. Use the beautiful-prose settings in AGENTS.md. Verify `pnpm docs:build` succeeds.
- [x] 1.6 Run `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm mutation`; read every survivor and kill it or justify it. Apply a mutation by hand before calling a survivor a tool artifact.
- [x] 1.7 Audit one real trace with the credentials already in the environment: run a question that makes the model use tools, fetch the observations through the API, and check that exactly one generation is `true`, that it is the last, that its text equals the root's output, and that no secret or machine detail is in the trace. Fix every gap.
- [x] 1.8 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [x] 1.9 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: flag the answer the user gets in the trace`.

## 2. Close

- [x] 2.1 After the slice: `/opsx:verify flag-final-answer`, fix what it finds, then archive as the last commit: `chore: archive flag-final-answer`, once the user approves.
