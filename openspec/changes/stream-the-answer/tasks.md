# Tasks

Pull request title: `feat: stream the answer and show the model's thinking`. Bump: minor.

Gate: no task starts before the user approves the spec. Both design questions are settled: thinking shows in auto mode with `--thinking` and `--no-thinking`, and the key guarantee covers the messages the CLI writes, not model text.

## Product slice 1: `feat:` stream the answer and show the thinking

### 1. Spikes and fixtures

- [x] 1.1 In the scratchpad, not the repo, prove that `nock` can serve a streamed SSE body that a test paces, and that the SDK's event stream consumes it chunk by chunk. Verify by a script that pushes one chunk, observes it in the consumer, then pushes the rest. Amend `design.md` ("Tests"). If `nock` cannot do it, stop and ask the user.
- [x] 1.2 (done early, recording kept in the scratchpad until the spec is approved) Record one real streamed response with nock's recorder, run from `packages/cli` so the CLI loads the user's `.env` itself. Never read or print any `.env` file. Use a short question. The user has authorized this one live call. Keep the SSE body only. Verify the body holds no key, cookie or header, and note where `usage` arrives, what thinking chunks look like, and whether keepalive comment lines appear. Amend `design.md` ("Risks").
- [x] 1.3 Find how to restart a 60 s timer on every chunk through the SDK's request options (a caller-owned `AbortController` first, a `fetch` wrapper second). Verify with a local server that stalls: the request aborts on the gap and not on a long, steady stream. Amend `design.md` ("Timeouts"). If neither works, stop and ask the user.
- [x] 1.4 Store the recording in `packages/cli/test/fixtures/` and derive two more by hand: an error chunk after the first answer text, and a stream cut off mid-chunk. Verify the three load in a test helper and none holds a secret.

### 2. Integration test first

- [x] 2.1 Write the failing integration tests in `test/ask.integration.test.ts` for every scenario in `specs/ask-question/spec.md`: stdout chunk by chunk with a paced stream, clean pipe, status lines with and without reasoning, retry only before output, failure after output, unusable stream, stream timeouts, the thinking table, thinking style, both flags, and the key never in a message. Verify they fail because the stream does not exist yet.

### 3. Pieces, each test first

- [x] 3.1 Flags. Failing tests first in `args.test.ts` and the integration suite: `--thinking`, `--no-thinking`, both together is a usage error, the usage text lists both. Then `args.ts` and `cli.ts`. Verify the tests pass.
- [x] 3.2 Reasoning count. Failing tests first in `status.test.ts`: the three rows of the status table, plus a property that the line carries the three counts for any non-negative integers. Then `status.ts` and `types.ts`. Verify the tests pass.
- [x] 3.3 Event stream. Failing tests first in `ask.test.ts`: content and thinking events in order, `done` carries model and usage, an error chunk throws `ApiError` with code and message, empty choices, thinking only, missing usage, encrypted and summary details yield nothing. Then turn `ask.ts` into an async generator. Verify the tests pass.
- [x] 3.4 Retry only before output. Failing tests first: a 503 then a stream retries; a drop after the first event does not; an error chunk with 5xx before any event retries; the earlier retry table still holds. Then move the loop inside the generator behind a "nothing yielded yet" check. Verify the tests pass and the wait property still holds.
- [x] 3.5 Stream timeouts. Failing tests first, with a short real idle limit (300 ms, a parameter) against a local server, because `nock` cannot take an abort: silence before the first chunk, a gap between chunks, a long steady stream that completes, a timeout is not retried. Then the idle race around the response and every chunk. Verify the whole `ask` suite runs in a few seconds.
- [x] 3.6 Presenter. Failing tests first in `present.test.ts` with string-collecting streams: the thinking table, dim and plain, `NO_COLOR` values, the closing newline, the blank line when stdout is a terminal, closing an open line on failure. Property: whatever the chunking, stdout equals the concatenated answer text plus one newline. Then `present.ts`. Verify the tests pass.
- [x] 3.7 Wiring. Add `isTTY` to the `stdout` and `stderr` in `Io`, pass `NO_COLOR` from `env`, run the stream through the presenter, close open lines on failure, keep redaction in the one catch. Verify the integration tests from 2.1 pass.
- [x] 3.8 Refactor only if the rubric calls for it; name the criterion. At most 3 passes.

### 4. Docs

- [x] 4.1 Update `docs/src/content/docs/ask-a-question.md` and the README: streaming, the thinking flags and their default (explain "stderr is a terminal" in plain words, with a table of the redirects that change it), `NO_COLOR`, partial output on failure and what exit 2 now means, the two timeouts. Write it with `beautiful-prose` using the AGENTS.md settings. Verify every documented command against a mocked run through the real entry point, and `pnpm docs:build` passes.

### 5. Close the slice

- [x] 5.1 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Verify all pass.
- [x] 5.2 Run `pnpm mutation`. Read every survivor: kill it, or disable it with a named mutator and reason. Verify the score is at or above the threshold and no survivors are left unexplained.
- [x] 5.3 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Tell each that a real `.env` exists in `packages/cli` and that no file named `.env` may be read, and that the CLI must not be run against the live API. Fix every must-fix finding, then rerun the checks.
- [x] 5.4 Write the product slice report. Wait for the user's approval, which also approves the commit. Commit as `feat: stream the answer and show the model's thinking`.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission. Never merge.
- Archive the change as the last commit before merge: `chore: archive stream-the-answer`. It never blocks the merge.
