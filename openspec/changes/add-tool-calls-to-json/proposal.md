# Proposal

## Why

Under `--json` a script sees the answer, the model and the tokens. It does not see how the answer was reached. The `tool:` lines are silenced, `--verbose` changes nothing, and the tool results the model read exist only in the Langfuse trace. An evaluation of the agent needs the whole trajectory: which tools the model called, with which arguments, what came back, and where it went wrong. A call with invalid arguments is as informative as one that worked, and today no caller can read either from the CLI.

## What Changes

- The success object and the failure object of a run that started gain `toolCalls`, a list with one entry per call: `round`, `name`, `arguments`, `output`, `failed`.
  - `round` is the number of the model response that asked for the call, from 1. Calls made together share a round.
  - `arguments` is the raw string the model sent, so invalid JSON stays visible.
  - `output` is the text the model received, complete and uncapped, with the OpenRouter key redacted. The consumer decides what to cut.
  - `failed` is `true` when the result was an error: an unknown tool, arguments that are not JSON, arguments that fail validation, a timeout, a dropped connection, a bad status.
- A call whose result is an error stays in the list. A tool that throws is recorded as failed, with the message as output, and the run fails as before.
- The calls the model asks for in the round that hits the limit are listed with `failed: true` and the output `[LIMIT_EXCEEDED] Tool calls limit exceeded`. They never ran and the model never saw this text.
- A call still running when the run fails, such as a sibling of a tool that threw, is listed with `failed: true` and the output `[TOOL_CALL_NOT_COMPLETED] Tool call did not complete`. Every call of a response that started running is in the list.
- The list is always present on success, empty when no tool was called. A failure before the run started has none.
- Both objects gain `args`, the arguments the CLI received, parsed: `verbose` always, `thinking` when a thinking flag was given, `model` when `--model` was given. A field not set is left out. A failure caused by the arguments has no `args`.
- `--verbose`, `--thinking` and `--no-thinking` stay accepted and change nothing in the output. The object now says which were given.
- The JSON Schema, the docs page and the `--json` entries of the help text follow.

No existing field changes and no input that worked stops working. The bump is minor (`feat:`).

Assumptions, open to correction at review:

- The Langfuse trace stays as it is. The calls of the limit round get no `tool` observation, so the object and the trace differ there.
- `args` does not repeat `question`, which the object already holds, and has no `json`, which is always true.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `json-output`: the fields of the success and failure objects, a new requirement for `toolCalls` and one for `args`, the rule for the display flags, the secrets rule and the published schema.

## Impact

- `packages/cli/src`: `types.ts` and `ask.ts` (a way to carry a call's result out of the run), `turn.ts`, `collector.ts`, `output.ts` (Zod schema, so also the generated JSON Schema), `cli.ts` and `args.ts` (hand the parsed arguments to the collector).
- `docs/src/content/docs/json-output.mdx` and the published `json-output.schema.json`.
- `openspec/specs/json-output`. Other capabilities, including `trace-content`, keep their requirements.
- No new dependency.
