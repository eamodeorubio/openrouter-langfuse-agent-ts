# Tasks

Pull request title: `feat: ask a question and get an answer from an OpenRouter model`. Bump: minor (first release, `v0.1.0`).

## Product slice 1: `feat:` ask a model

### 1. Spike and setup

- [x] 1.1 Add `@openrouter/sdk` with `pnpm add` (needs approval). Verify `pnpm install` and `pnpm typecheck` pass.
- [x] 1.2 In the scratchpad, not the repo, write a throwaway script. Record the SDK's call name, request and response shapes, error classes, default retries and timeout, and whether `nock` intercepts it. Verify by a mocked 200 and a mocked 500 that both reach the script. Amend `design.md` ("Calling OpenRouter" and "Risks") with the findings. If `nock` fails, stop and ask the user.
- [x] 1.3 Add `OPENROUTER_MODEL` to `.env.example`. Verify the file lists it with a comment saying it is the answering model.

### 2. Integration test first

- [x] 2.1 Write `test/ask.integration.test.ts`: drive `run` with injected argv, env, stdin and capture streams, `nock` for the API. Cover every scenario in `specs/ask-question/spec.md`: question sources, missing question, unknown args, model table, missing key, key never printed, `.env` value and precedence, validation order, clean stdout, status lines, 401, network error, empty choices, missing usage. Verify it fails because `run` does not exist.

### 3. Pieces, each test first

- [x] 3.1 `errors.ts` and `status.ts`. Unit test: status output equals the spec example. Property test: the lines contain the given model and the three counts for any non-negative integers.
- [x] 3.2 `args.ts`. Unit tests: `-q`, `--model`, empty `-q`, `-q` without value, stray positional, unknown option. Property test: never throws for any string array; returns a result or a `UsageError`.
- [x] 3.3 `config.ts`. Unit tests: the model table, blank key and model, `.env` read from a temporary directory, environment beats `.env`, missing `.env` ignored. Property test: result is `--model` when it is non-blank, else the env value, else an error.
- [x] 3.4 `input.ts`. Unit tests: `-q` wins and stdin is not read, stdin trimmed, terminal stdin, empty stdin, whitespace stdin. Property test: any text round-trips through stdin modulo surrounding whitespace.
- [x] 3.5 `ask.ts`. Unit tests with `nock`: request carries model and question, answer and served model returned, 401 and 500 become `ApiError` with status, network error becomes `ApiError`, empty choices, missing content and missing usage rejected. Verify no test reaches the network.
- [x] 3.6 `cli.ts` and `index.ts`. Verify the integration test from 2.1 now passes. Remove the old `name` export test if the export is gone.
- [x] 3.7 Refactor only if the rubric calls for it; name the criterion. At most 3 passes.

### 4. Docs

- [x] 4.1 Replace the "no release yet" status text in `README.md` with a usage section: install, `.env`, `-q`, stdin, `--model`, exit codes, stdout and stderr. Write it with `beautiful-prose` using the AGENTS.md settings. Verify each documented command runs as written against a mocked or real key.
- [x] 4.2 Add a usage page to `docs/src/content/docs/`. Verify `pnpm docs:build` succeeds.

### 5. Close the slice (first pass, done)

- [x] 5.1 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Verify all pass.
- [x] 5.2 Run `pnpm mutation`. Read every survivor: kill it, or disable it with a named mutator and reason. Verify the score is at or above 80.
- [x] 5.3 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding, then rerun the checks.
- [x] 5.4 Write the product slice report. Wait for the user's approval, which also approves the commit. Commit as `feat: ask a question and get an answer from an OpenRouter model`.

### 6. Follow-up after the first report

- [x] 6.1 Replace the hand-written success and 401 mocks with the recorded fixtures in `test/fixtures/` (bodies only, no headers). Verify the full suite passes and no fixture holds a key, cookie or header.
- [x] 6.2 Spec scenario "Question that starts with a dash": failing test first in `args.test.ts` and the integration suite, then make `-q` take the next argument whatever it starts with. Verify `-q "-5 degrees"` reaches the model and the args round-trip property drops its dash filter.
- [x] 6.3 Spec requirement "Retry transient failures": failing tests first (503 then 200, five 503s, 401 once, 429, connection error, timeout not retried, waits within the table for any random value), then the loop in `ask.ts`. Verify the tests record the waits without sleeping.
- [x] 6.4 Update `ask-a-question.md` and the README: retries, the dash rule, and drop the stdin workaround note. Verify `pnpm docs:build` and `pnpm check`.
- [x] 6.5 Rerun checks, `pnpm mutation` and the three reviewers on the changes; fix every must-fix finding; update the slice report.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission. Never merge.
- Archive the change as the last commit before merge: `chore: archive ask-a-model`. It never blocks the merge.
