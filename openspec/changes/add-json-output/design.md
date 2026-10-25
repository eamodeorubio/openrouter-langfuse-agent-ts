# Design

## Context

`run` in `cli.ts` parses arguments, loads the config, opens the tracer and iterates `ask`, handing each `AskEvent` to a presenter that writes straight to the sinks. Failures are classified in one `catch` that maps the error class to an exit code and writes a line to stderr. See proposal.md for why.

## Goals / Non-Goals

**Goals:**
- `model` and `usage` in the success object, from the data the run already has.
- One place that decides the shape of the object and the error code of each failure.
- The existing event stream stays the single source: the same `ask` feeds both modes.

**Non-Goals:**
- Changing the `model:` and `tokens:` lines of plain mode, or adding cost to them.
- A per-request breakdown of the usage. The object reports the question, not each round.
- Changing `ask`, the retry rules or the tracing.
- Model and token counts in the object; they can be added later as fields without breaking readers.

## Decisions

**Collect, then print.** In JSON mode a collector takes the place of the presenter. It has the same `handle(event)` entry, accumulates content, thinking and trace id, and offers `success()` and `failure(error)` that return the object. The alternative, a flag inside the presenter, would add a branch to every case and mix two output contracts in one module. A second small module with one job is easier to test and to kill mutants in.

**Error code from the error class.** The error classes already carry the exit-code meaning (`UsageError`, `ConfigError`, `ApiError`, `LimitError`). A single function maps class to `{ code, exit }`, and the table in the spec is its test. `TIMEOUT` is the one split inside `ApiError`: `toApiError` creates the timeout, so it gets a subclass, `TimeoutError extends ApiError`, which keeps the exit code at 2. The alternative, matching message text, breaks when the wording changes.

**Failure in the same `catch`.** The existing `catch` keeps deciding the exit code. It only chooses the sink text: usage-plus-message in plain mode, the failure object in JSON mode. The message passes through `redactAll` before it enters the object, as today.

**Flag before parsing.** If `parseCliArgs` throws, the options are unknown. `run` looks for a literal `--json` in `argv` first; that is enough to pick the output format for a usage error. A `-q --json` question text could match, which is harmless: it only picks the format of an error.

**Flush failure.** `run` already writes the flush message to stderr. In JSON mode it writes a failure object with `TRACE_FLUSH_FAILED` there instead, but only after a clean run: a run that failed has already written its object, and a second one would break the rule of one object per stream. The success object has been written by then; the two streams stay separate.

**A seam for the idle limit.** `Io` gains `idleTimeoutMs`, forwarded to `ask` like `serverURL`, so that a test can run the `TIMEOUT` path through `run` without waiting 60 s. The real entry point leaves it unset.

**Silence.** In JSON mode `execute` skips `NOT_TRACED`, and the collector ignores `tool` events. `--verbose`, `--thinking` and `--no-thinking` are parsed, and then have no reader.

**Model and usage come from the `done` event.** The collector keeps them as it keeps the trace id, and `success()` adds them. `failure()` ignores them, so the rule of the spec holds without a branch to remember. The alternative, passing the final completion to `success()` from `cli.ts`, would make `cli.ts` assemble the object, which the collector exists to avoid. A failed run ends without a `done` event, and a sum over the requests that finished would look complete when it is not.

**`addUsage` keeps cached tokens and cost, with a rule per field.** It added prompt, completion, total and reasoning tokens and dropped `cachedTokens` and `cost`, which `chat.ts` reads from each response. Plain mode needed neither, so nothing noticed. Cached tokens follow the rule of reasoning tokens: absent when neither side has them, a sum otherwise. Cost is stricter: absent when either side lacks it. The sum in `ask.ts` starts from a zero usage that carries a zero cost, so that the first request's cost survives and a missing one anywhere removes it. A separate "all requests reported" flag would duplicate what the sum can say by itself. `formatStatus` reads the same fields as before.

**`usage` is a strict nested object.** Three required counts and three optional fields, so the generated schema forbids stray fields as it does for the rest of the object. Counts are non-negative integers and the cost a non-negative number. Costs are added as they come, unrounded: rounding would hide digits the API gave and pick a precision for the caller, who can format dollars. Key order is not part of the contract; the tests compare parsed objects.

**Zod is the source; the schema is generated.** `zod` is already a dependency of the CLI. The object is described once as a Zod schema: a discriminated union on `success`, strict objects, a regex on `error.code`. Zod 4 turns it into JSON Schema with `z.toJSONSchema`. The same Zod schema types the collector (`z.infer`), so the code, the type and the published schema cannot disagree. The reverse, a handwritten schema with generated types, needs a generator dependency and gives types only; Zod gives the types and the schema from one place with no new runtime dependency.

**The generated file is committed.** A script (`pnpm schema:generate`) writes `docs/public/schemas/json-output.schema.json`. The file is committed because the raw GitHub URL of `$id` must resolve at the release tag. A test regenerates the schema in memory and fails when the committed file differs, so nobody edits it by hand or forgets to regenerate. The test also validates real objects from the integration run, and the accepted and rejected examples of the spec, against the committed file with Ajv (2020-12 build, dev dependency): this checks the file users consume, not Zod's own opinion of it.

**One reader of the file in the docs.** The output page is an `.mdx` file that imports the committed file and renders it in a code block, so the page cannot drift from the file.

**`$id` is the raw URL at the release tag.** `https://raw.githubusercontent.com/eamodeorubio/openrouter-langfuse-agent-ts/v<version>/docs/public/schemas/json-output.schema.json`. The generator reads the version from `packages/cli/package.json`. Release Please bumps the version in its release PR, and it must bump the `$id` in the same commit, or the tag would hold a schema that points at the previous tag. The file is therefore a `generic` extra file in `release-please-config.json`: the generator writes `$id` and a `$comment` of `x-release-please-version` on one line, and the updater replaces the version on that line. The file is excluded from the formatters so the line stays as written. The drift test compares against the generated output for the current `package.json` version, so a release PR that bumps only one of the two fails the test. Between releases the `$id` names the last release, whose tag does not hold this file yet; the URL resolves from the release that ships it.

## Risks / Trade-offs

- [A signal ends the run mid-way] → No object is written; the exit code is 130 or 143 as before. A caller sees a killed process, which it already expects.
- [Answer is large] → It is held in memory until the end. The answer is already bounded by the model's output.
- [Two JSON documents for one failed-flush run, one on each stream] → Documented in the spec; each stream still carries at most one object.
- [Release Please might not rewrite the `$id` line] → Task 1.6a checks the config with a dry run before the slice is reported; if the updater cannot do it, stop and ask rather than pin by hand.
- [`z.toJSONSchema` might not emit what the spec needs, such as `oneOf` and `additionalProperties: false`] → The tests validate the committed file with Ajv against the spec examples, so a gap shows up as a failing test.
- [`cost` is rarely present if some requests omit it] → That is the point: an understated total is worse than none. The docs say when `cost` appears.
- [A provider reports cost on the final request only] → The sum has no `cost`; the trace still holds the per-request costs.
- [Floating-point noise in the last digits of a summed cost] → Documented; callers format dollars.
- [Field names are a public contract from now on] → Kept few and plain; adding fields later is compatible.
