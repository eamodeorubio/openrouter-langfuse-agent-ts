# Tasks

Two product slices, then close. Slice 1 is a `feat:` (minor). Slice 2 is a `feat:` too, so the pull request title is `feat: trace the agent with Langfuse` (minor). Reviewers for each slice: all three; full report. Run `pnpm mutation` after each, because `src/` logic changes.

## 1. Slice 1: `feat: trace each run in Langfuse` (minor)

Specs: *Tracing switch*, *Base URL validation*, *Credential check before work*, *Flush before exit*, *Flush failure*, *Keys stay out*, *Observation tree*, *Names are stable*, *Root input and output*, *Generation content*, *Tool content*, *Errors on generations*, *Tracing never changes the answer*.

- [x] 1.1 Read the Langfuse API reference for `GET /api/public/projects` and `LangfuseSpanProcessor` options in v6.0.2; confirm the path, the 401 answer, whether `forceFlush` reports a failed export, and whether observations made from a parent handle inherit propagated attributes (design: where the details enter). Verify by writing the findings into design.md, and settle the first risk there.
- [x] 1.2 Add `@langfuse/tracing`, `@langfuse/otel` and the OpenTelemetry packages they need at exact versions with `pnpm add` (`sdk-trace-node` replaced `sdk-node`; see the design). Verify `pnpm install --frozen-lockfile` and `pnpm typecheck` pass.
- [x] 1.3 Failing integration test through `run`, covering *Observation tree*, *Root input and output* and *Flush before exit*: the local fake server for OpenRouter (one tool round and an answer) and for the Langfuse preflight, and an in-memory exporter. Assert the tree, types, names and order. Verify it fails because nothing is traced.
- [x] 1.4 Failing unit tests, then code, for config: every row of *Tracing switch*, blank values, *Base URL validation*. Property: any strict subset of the three variables is a configuration error naming exactly the missing ones.
- [x] 1.5 Failing unit tests, then code, for the credential check: every row of its table, plus *Keys stay out* on the error line. Use a real server on `127.0.0.1`.
- [x] 1.6 Failing unit tests, then code, for the `Tracer` interface and its no-op twin: untraced run output is byte-identical to today's for the existing integration suite.
- [x] 1.7 Failing unit tests, then code, for generations in `chat` (*Generation content*, *Errors on generations*, retries as metadata). Use the local server from `test/fakeApi.ts` for a stream that breaks.
- [x] 1.8 Failing unit tests, then code, for tools in `turn.ts` (*Tool content*, *Parallel calls*): failure sets level and status message.
- [x] 1.9 Failing unit tests, then code, for flush: success, failed run, SIGINT, and a 500 from the OTLP endpoint served by a real server (*Flush failure*, both scenarios). Property: the exit code never drops once non-zero.
- [x] 1.10 Failing test, then code, for *Tracing never changes the answer*: a tracer that throws on every call leaves stdout and exit code as untraced.
- [x] 1.11 Update the usage guide and README: what turns tracing on, the warning, the exit codes, what a trace holds, that questions and answers are exported, and what masking does not cover (names, addresses and other free-form personal data). Use the beautiful-prose settings in AGENTS.md. Verify `pnpm docs:build` succeeds and `.env.example` matches.
- [x] 1.12 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm mutation`; read every survivor and kill or justify it.
- [x] 1.13 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [x] 1.14 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: trace each run in Langfuse`.

## 2. Slice 2: `feat: put cost, thinking, ids and masking in the trace` (minor)

Specs: *Verbose flag* (modified in `ask-question`), *Usage and cost*, *Stream events*, *Trace attributes*, *Masking*, *Trace id*, *Context to OpenRouter*. Same reviewers and report as slice 1. The Langfuse and OpenRouter variables are already in the user's environment, so the audit runs without asking for anything; never print their values and never read `.env`.

- [x] 2.1 Read the v6.0.2 types for what slice 2 leans on: how an `event` is made and whether it ends itself, the attribute keys of `usageDetails` and `costDetails`, and the W3C header `W3CTraceContextPropagator` writes. Verify by writing the findings into design.md.
- [x] 2.2 Failing integration test through `run`, covers *Usage and cost*, *Trace attributes*, *Trace id*, *Context to OpenRouter* and *Stream events*: the fake API records `traceparent`; assert each generation's buckets and cost, `version` on every observation, one `receive-first-token`, a header whose trace id is the export's and whose parent is the generation of that request (the tool for a catalog request), a `trace:` line first on stderr with `--verbose`, and no `traceparent` untraced. Verify it fails for the missing data.
- [x] 2.3 Failing unit tests, then code, for the buckets: every row of the *Usage and cost* table, no cost when none is reported, and properties (every bucket is zero or more, the buckets sum to `total`, for any reported counts including cached above prompt and reasoning above completion). `Usage` gains the cost and the cached count; `addUsage` and the status lines stay as they are.
- [x] 2.4 Failing unit tests, then code, for the events: `receive-first-token` once at the first text or thinking, never per chunk; `fail-stream` for a stream that breaks or goes idle and ends the request, not for a retried attempt. Use the local server from `test/fakeApi.ts` for broken and stalled streams.
- [x] 2.5 Failing unit tests, then code, for *Trace attributes*: the version equals that of `package.json`; every observation carries it; `LANGFUSE_TRACING_ENVIRONMENT` is validated at the boundary (`^(?!langfuse)[a-z0-9-_]+$`, at most 40 characters, else exit 1 naming it) and read from `.env` too; the release is `LANGFUSE_RELEASE` or the version; no session id and no user id.
- [x] 2.6 Failing unit tests, then code, for *Masking*: each example (email, bearer token, `sk-or-`, `sk-lf-`, `pk-lf-` shapes) in input, output, metadata, status message and tool name; properties (no match survives, idempotent, a text with no match is unchanged); an integration case showing the model still received the original text and that no exported attribute holds an `Authorization` value or an environment value.
- [x] 2.7 Failing tests, then code, for *Trace id* and the *Verbose flag* delta: with `--verbose` one `trace:` line on stderr when the root opens, none without it, none untraced. The root exposes its id, `ask` yields it as an event, the presenter prints it.
- [x] 2.8 Failing tests, then code, for *Context to OpenRouter*: a span gives `00-<trace id>-<span id>-01` and an untraced span gives nothing; `chat` passes it as `headers` to `chat.send`; the tools pass it to `models.get` and `models.list` through the per-call options in `ToolContext`; the integration test sees the header on a chat request and on each kind of catalog request, none untraced, and two parallel tools each carrying its own span id.
- [x] 2.9 Update the usage guide, the README and `.env.example`: tokens and cost in the trace, the version, environment and release, the `trace:` line, the wider masking (and what it still does not cover), the `traceparent` header, and the end of "What is not here yet". Use the beautiful-prose settings in AGENTS.md. Verify `pnpm docs:build` succeeds.
- [x] 2.10 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm mutation:full`; read every survivor and kill or justify it. Apply any survivor's mutation by hand before calling it a tool artifact.
- [x] 2.11 Audit one real trace. Run `pnpm dev --verbose -q "<a question that makes the model use two tools>"` with the environment as it is, note the trace id, fetch the trace and its observations with the `langfuse` skill's CLI through `pnpm dlx`, fetch the best-practices page fresh, and check each observation against it. Fix every gap, run again, and report the final trace id. Verify with the fetched trace: types, names, nesting, input and output, model, usage, cost, thinking, version, no secret.
- [x] 2.12 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [x] 2.13 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: put cost, thinking, ids and masking in the trace`.

## 3. Close

- [ ] 3.1 After the last slice: `/opsx:verify add-langfuse-tracing`, fix what it finds, then archive as the last commit: `chore: archive add-langfuse-tracing`, once the user approves.
