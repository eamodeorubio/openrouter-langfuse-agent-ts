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
- [x] 2.13 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: let the agent look up a model`.

## 3. Slice 2: `feat: let the agent search the model catalog` (minor)

Delivers `search_models` and the shared catalog wrapper. Spec: *search_models arguments*, *search_models result*, *Prices in USD per million tokens*. Fixture: `models-list.200.json`, recorded in the spikes.

- [x] 3.1 Failing integration test, covers *search_models arguments* and *result* through `run`: the model calls `search_models` with a sort, a required parameter and a limit; assert the `GET /models` query, that the result sent back holds `total`, `next_offset` and models without descriptions, with prices in USD per million, and that the answer reaches stdout. Verify it fails for the unknown tool.
- [x] 3.2 Failing unit tests, then code, for the arguments schema: every row of the arguments table, the `limit` bounds, unknown keys, enum values for `category` and `sort`, and lists as lists.
- [x] 3.3 Failing unit tests, then code, for the request: each argument under the API's own name (`query` as `q`, `min_context_length` as `context`, price floors and ceilings, `architecture` as `arch`, `authors` as `model_authors`, `zero_data_retention` as `zdr`); lists joined by commas; defaults `limit=10`, `offset=0`; `zero_data_retention: false` sends nothing.
- [x] 3.4 Failing unit tests, then code, for the result against the fixture: the listed fields only, prices per million, `supports_reasoning`, benchmark indices (`null` when absent), `created` as a date, no description; `next_offset` is `offset + count` when the API has a next page and `null` otherwise. Property: `next_offset` is `null` or greater than `offset`, whatever the page.
- [x] 3.5 Extract the "call the catalog, turn expected failures into a result" wrapper that `get_model` holds into `tools/catalog.ts`, and use it from both tools; existing tests stay green. Refactor criterion: duplication, single responsibility.
- [x] 3.6 Register the tool; update the loop test that lists the offered tools; test that the schema offered to the model carries the argument descriptions and units.
- [x] 3.7 Update the user-facing docs: `README.md`, `docs/src/content/docs/ask-a-question.md` (a section on searching with the filters table, a real `--verbose` run) and `docs/src/content/docs/index.md`. Use the beautiful-prose settings in AGENTS.md. Verify every command shown runs as written, and that `pnpm docs:build` succeeds.
- [x] 3.8 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm mutation`; read every survivor and kill or justify it.
- [x] 3.9 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`; fix every must-fix finding.
- [ ] 3.10 Write the full report. Wait for the user's approval, which also approves the commit. Commit `feat: let the agent search the model catalog`.

## 4. Slice 3: `feat: let the agent do arithmetic` (minor)

Named only. Adds `calculate` (*calculate grammar*, *calculate result*, *calculate failures*, *calculate never evaluates code*) to the registry, and the system message's line about arithmetic, with its tests (including the oracle property test), docs, mutation run, reviewers, report and commit. Planned in detail once slice 2 is approved.

## 5. Close

- [ ] 5.1 After all three slices: `/opsx:verify add-model-tools`, fix what it finds, then archive as the last commit: `chore: archive add-model-tools`, once the user approves.

## Workflow follow-up

- Push the branch and open the pull request only with the user's permission, asked each time. Propose title and description first.
