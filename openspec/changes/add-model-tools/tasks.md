# Tasks

Product slices, in order. PR title: `feat: answer with live model data from OpenRouter` (bump: minor). Change type of each slice: new behavior; reviewers: all three; full report.

## 1. Spikes (no commit)

- [x] 1.1 With the user's permission, make one `GET /models?limit=2` and one `GET /model/{author}/{slug}` with a normal key; verify neither answers 403. Record both bodies as fixtures (bodies only). If either answers 403, stop and ask.
- [x] 1.2 With the user's permission, record one streamed request to a reasoning model with a tool offered, ending in a tool call. Verify from the recording how reasoning details and tool-call fragments arrive; fix the join rule in `design.md` if it differs.

## 2. Slice 1: `feat: let the agent look up a model` (minor)

Delivers the loop, the system message, parallel calls, reasoning continuity, `get_model`. The request offers only the tools that exist at the end of the slice.

- [x] 2.1 Failing integration test, covers *Rounds until the model answers*, *Parallel tool calls*, *Reasoning continuity*: two rounds against the fake API; round 1 returns two `get_model` calls and reasoning details in fragments; assert stdout, that stderr holds no `tool:` line without `--verbose` and the lines with it, and the round 2 body (tool messages in order, details joined). Verify it fails for the missing loop.
- [x] 2.2 Failing unit tests, then code, for `prices.ts`: examples from *Prices in USD per million tokens*; properties: shift round trips, non-negative strings yield non-negative numbers, anything else yields `null`, never throws.
- [x] 2.3 Failing unit tests, then code, for `get_model`: *get_model arguments* table, request path, *get_model result* fields, omitted fields. Verify against the recorded fixture.
- [x] 2.4 Move retry into `retry.ts` and the single request into `chat.ts`; existing tests stay green. Refactor criterion: single responsibility (ask.ts would hold the loop, the request and the retry).
- [x] 2.5 Failing unit tests, then code, for fragment assembly in `chat.ts`: tool calls by `index`, reasoning details by `index`; property: any split of a message into fragments joins to the same message.
- [x] 2.6 Failing unit tests, then code, for the loop in `ask.ts`: round limit and forbidden tools (a `LimitError`, exit 3 through `run`), tool failures table, concurrent start, call order, token sum (*Two rounds*), *Retry applies to each request*, *Tool calls without text*.
- [x] 2.7 Failing unit tests, then code, for `--verbose` (*Verbose flag*, in `args.ts` and the usage text) and the `tool` event in `present.ts`: dropped without the flag, line text, 200-character cut, order against an open thinking line, round separator.
- [x] 2.8 Failing test, then code, for key redaction in tool results and `tool:` lines (*Key echoed by the API*).
- [x] 2.9 Add the system message; test that it is first and names the units. Declare `zod` as a dependency with `pnpm add`.
- [x] 2.10 Update the user-facing docs: `README.md`, `docs/src/content/docs/ask-a-question.md` and, if it describes what the agent does, `docs/src/content/docs/index.md`. Cover tools, `--verbose` and `tool:` lines, the exit-code table, summed tokens, a worked example. Use the beautiful-prose settings in AGENTS.md. Verify every command shown runs as written against the fake API, and that `pnpm docs:build` succeeds.
- [x] 2.11 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm mutation`; read every survivor and kill or justify it.
- [x] 2.12 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [ ] 2.13 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: let the agent look up a model`.

## 3. Slice 2: `feat: let the agent search the model catalog` (minor)

Named only. Adds `search_models` (*search_models arguments*, *search_models result*) to the registry, with its tests, docs, mutation run, reviewers, report and commit. Planned in detail once slice 1 is approved.

## 4. Slice 3: `feat: let the agent do arithmetic` (minor)

Named only. Adds `calculate` (*calculate grammar*, *calculate result*, *calculate failures*, *calculate never evaluates code*) to the registry, and the system message's line about arithmetic, with its tests (including the oracle property test), docs, mutation run, reviewers, report and commit. Planned in detail once slice 2 is approved.

## 5. Close

- [ ] 5.1 After all three slices: `/opsx:verify add-model-tools`, fix what it finds, then archive as the last commit: `chore: archive add-model-tools`, once the user approves.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked each time. Propose title and description first.
