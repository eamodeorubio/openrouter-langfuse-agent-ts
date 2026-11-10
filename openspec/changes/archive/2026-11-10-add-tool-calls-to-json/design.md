# Design

## Context

See proposal.md for the motivation and specs/json-output/spec.md for the requirements.

The data exists, but it sits in the wrong place. `converse` in `ask.ts` yields a `tool` event for each call, carrying the name and the arguments, before any call runs. `runCalls` in `turn.ts` then runs the batch and holds, for each call, the redacted `output` and `failed`. It hands them to the trace span and returns only the tool messages for the next request. The collector, which builds the `--json` object, listens to `AskEvent`s and has never seen a result.

Three facts shape the approach:

- `callTool` already turns every model mistake into a result: an unknown tool, arguments that are not JSON, arguments that fail validation. `callCatalog` does the same for timeouts, dropped connections and bad statuses. All of them reach `runCalls` as `{ ok: false }`, so `failed` costs nothing.
- A call that throws is the exception. `runCalls` rethrows it through `Promise.all`, and the run ends as `UNEXPECTED_ERROR` before `converse` sees any outcome.
- The round that hits the limit throws `LimitError` before it runs anything, so those calls have no outcome and today leave no trace in any output.

The parsed arguments live in `execute` in `cli.ts` and never reach the collector.

## Goals / Non-Goals

**Goals:**

- Carry each call's outcome from `runCalls` to the collector without touching what the model receives or what the trace records.
- Keep the Zod schema in `output.ts` the single definition, so the published JSON Schema follows from it.

**Non-Goals:**

- No change to the Langfuse trace. The calls of the limit round get no `tool` observation, so the object and the trace differ there. `trace-content` keeps its requirements.
- No change to the plain output, to `--verbose` and its `tool:` lines, or to what a tool returns to the model.
- No cap, summary or parsing of `arguments` and `output`. They are strings, as the model sent and received them.
- A tool abort or an unmapped SDK error does not become a result for the model. It keeps its current path: a thrown error, `UNEXPECTED_ERROR`, now with the call listed.

## Decisions

### One self-contained event per finished call

`AskEvent` gains `{ kind: 'tool-call', round, name, arguments, output, failed }`. The collector appends it and nothing else. The existing `tool` event stays as it is, since the presenter prints its line when the call starts, which can be a minute before the result.

The alternative was to extend `tool` with an id and send a second event with the result, then join them in the collector. That puts a join, and a state for calls with no result yet, in the collector. A finished-call event has no join and no partial state: `converse` decides the outcome of every call, including one that never returned, before the event leaves it.

The presenter ignores the new event.

### Outcomes are collected as calls end, and yielded in the model's order

`runCalls` takes a list to fill, and writes each call's outcome at the call's index when the call ends. `converse` yields the events from that list in index order after the batch resolves. Results that arrive out of order therefore still appear in the order of the model's response, with no sort.

When `runCalls` throws, `converse` catches, yields one event for every call of the batch, and rethrows the original error. A call with an outcome gets it. The thrown call's outcome is the redacted message with `failed: true`, which is what its span already records. A sibling still running has none and gets `failed: true` with the output `[TOOL_CALL_NOT_COMPLETED] Tool call did not complete`. The run does not wait for it, so the failure is not delayed by up to a tool timeout, and whatever the sibling returns later is dropped. A sibling that finished before the catch ran keeps its real result. Because the batch is known from the response, the list never loses a call, and `converse` needs no rule for skipping one.

The generator catches the error, yields the events after the `try` and rethrows. It does not yield from a `finally`: a `yield` there would swallow a `return()` from a reader that stopped early.

### The limit round is reported where it is detected

When the round after the eighth still asks for tools, `converse` yields one `tool-call` event per call, with `failed: true` and the output `[LIMIT_EXCEEDED] Tool calls limit exceeded`, then throws `LimitError` as before. No `tool` event is yielded, so `--verbose` output does not change. The output is built from the same code constant `classify` uses for `error.code`, so the two cannot drift apart. That constant is new: `classify.ts` holds the string as a literal today. `TOOL_CALL_NOT_COMPLETED` is a tag in an `output`, not an `error.code`: the code table of the spec does not change, and no run ends with it. A small helper builds `[CODE] message` for both tags.

The `round` of an event is `toolRounds + 1` in `converse`: the count of the response that asked, from 1.

### `args` comes from the parser, set once

`execute` hands the parsed arguments to the collector right after `parseCliArgs` succeeds, and the collector maps them to the object's `args`: `verbose` always, `thinking` and `model` when set. A failure of the parser leaves the collector without arguments, so that object has no `args`, as it has no `question`.

`args.model` is user text. It passes through the same redaction as the error message, with the secrets known at that point.

### The schema gets two fields and a strict entry

In `output.ts`, `toolCalls` is a required array of strict entries on the success object and an optional one on the failure object. `args` is a required strict object on success and optional on failure, with `verbose` required inside it. `round` is an integer of at least 1. `ToolCall`, `ToolCalls` and `Args` carry an `id`, so the generator emits each once under `$defs` and both objects refer to it, and a test pins that. The note on when each field is absent sits in the failure object's description. `schema:generate` rewrites the published JSON Schema, and the existing test that compares the file to the Zod definition keeps them in step.

## Risks / Trade-offs

- [The object has no size bound.] → Deliberate, since an eval needs the whole trajectory and the consumer can cut. A 50-entry `search_models` page is in the tens of kilobytes. The docs say the field is uncapped.
- [A reader compares the object with the trace and finds the limit-round calls only in the object.] → Written as a non-goal, in the docs and in the spec scenario. The limit round is a failed run anyway, and its `error.code` says so.
- [A sibling that finishes in the instant before the catch runs shows its result, and one that finishes just after shows `TOOL_CALL_NOT_COMPLETED`.] → Either is true of that moment. The spec promises the second only for a call still running, and the tests use a stalled sibling.
- [`output` for the limit round and for an unfinished call is text the model never saw.] → The docs say `output` is what the model received, or, for a call that never ran or never returned, the reason.
- [Callers of `runCalls` outside `converse`.] → Only `converse` and its tests call it. The tests pass the list.
