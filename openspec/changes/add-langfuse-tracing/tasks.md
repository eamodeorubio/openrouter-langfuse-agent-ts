# Tasks

Two product slices, then close. Slice 1 is a `feat:` (minor). Slice 2 is a `feat:` too, so the pull request title is `feat: trace the agent with Langfuse` (minor). Reviewers for each slice: all three; full report. Run `pnpm mutation` after each, because `src/` logic changes.

## 1. Slice 1: `feat: trace each run in Langfuse` (minor)

Specs: *Tracing switch*, *Base URL validation*, *Credential check before work*, *Flush before exit*, *Flush failure*, *Keys stay out*, *Observation tree*, *Names are stable*, *Root input and output*, *Generation content*, *Tool content*, *Errors on generations*, *Tracing never changes the answer*.

- [x] 1.1 Read the Langfuse API reference for `GET /api/public/projects` and `LangfuseSpanProcessor` options in v6.0.2; confirm the path, the 401 answer, whether `forceFlush` reports a failed export, and whether observations made from a parent handle inherit propagated attributes (design: where the details enter). Verify by writing the findings into design.md, and settle the first risk there.
- [x] 1.2 Add `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node` and `@opentelemetry/api` at exact versions with `pnpm add`. Verify `pnpm install --frozen-lockfile` and `pnpm typecheck` pass.
- [x] 1.3 Failing integration test through `run`, covering *Observation tree*, *Root input and output* and *Flush before exit*: a `nock`ed OpenRouter with one tool round and an answer, `nock` on the Langfuse preflight, and an in-memory exporter. Assert the tree, types, names and order. Verify it fails because nothing is traced.
- [x] 1.4 Failing unit tests, then code, for config: every row of *Tracing switch*, blank values, *Base URL validation*. Property: any strict subset of the three variables is a configuration error naming exactly the missing ones.
- [x] 1.5 Failing unit tests, then code, for the credential check: every row of its table, plus *Keys stay out* on the error line. Use `nock`.
- [x] 1.6 Failing unit tests, then code, for the `Tracer` interface and its no-op twin: untraced run output is byte-identical to today's for the existing integration suite.
- [x] 1.7 Failing unit tests, then code, for generations in `chat` (*Generation content*, *Errors on generations*, retries as metadata). Use the local server from `test/fakeApi.ts` for a stream that breaks.
- [x] 1.8 Failing unit tests, then code, for tools in `turn.ts` (*Tool content*, *Parallel calls*): failure sets level and status message.
- [x] 1.9 Failing unit tests, then code, for flush: success, failed run, SIGINT, and a `nock`ed 500 from the OTLP endpoint (*Flush failure*, both scenarios). Property: the exit code never drops once non-zero.
- [x] 1.10 Failing test, then code, for *Tracing never changes the answer*: a tracer that throws on every call leaves stdout and exit code as untraced.
- [x] 1.11 Update the usage guide and README: what turns tracing on, the warning, the exit codes, what a trace holds, that questions and answers are exported, and what masking does not cover (names, addresses and other free-form personal data). Use the beautiful-prose settings in AGENTS.md. Verify `pnpm docs:build` succeeds and `.env.example` matches.
- [x] 1.12 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm mutation`; read every survivor and kill or justify it.
- [x] 1.13 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [x] 1.14 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: trace each run in Langfuse`.

## 2. Slice 2: `feat: put cost, thinking, ids and masking in the trace` (minor)

Named only. Specs: *Verbose flag* (modified in `ask-question`), *Usage and cost*, *Stream events*, *Trace attributes*, *Masking*, *Trace id*, *Context to OpenRouter*. Planned in detail once slice 1 is approved. It ends with the audit: run one real traced question with keys the user sets in their own shell, fetch the trace with the `langfuse` skill's CLI, and check it against the best-practices page, fetched fresh.

## 3. Close

- [ ] 3.1 After the last slice: `/opsx:verify add-langfuse-tracing`, fix what it finds, then archive as the last commit: `chore: archive add-langfuse-tracing`, once the user approves.
