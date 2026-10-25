# Proposal

## Why

The CLI writes for a person: the answer streams to stdout, the thinking and status lines go to stderr, and a failure is one line of prose. A script that wants the answer, the trace id or the reason for a failure has to scrape that text. A machine-readable mode gives callers one object to parse, with a stable error code to branch on.

## What Changes

- New `--json` flag. With it, the CLI writes one JSON object once the run has ended, and nothing streams to the terminal.
- On success the object goes to stdout: the question, the answer, `success: true`, the thinking and the trace id when there are any.
- On failure the same shape goes to stderr, with `success: false` and an `error` object holding a user-facing message and a non-numeric `UPPER_SNAKE_CASE` code.
- Exit codes do not change.
- A JSON Schema describes the success and the failure object. It is generated from the Zod schema that types the object in the code, so there is one definition to maintain. It is published with the docs, and its `$id` is the raw GitHub URL of the file at the release tag, so users can read it, link to it and validate output against it.
- The usage message lists the flag, and the user docs describe the object.

Assumptions, open to correction at review:

- "Both stderr and stdout" means success on stdout and failure on stderr, never both for one run. This keeps the rule that results go to stdout and errors to stderr.
- The field for the status is `success`, a boolean.
- Under `--json`, the `tool:` lines, the status lines and the "tracing is off" notice are not written. Model and token counts are left out of the object for now.

## Capabilities

### New Capabilities
- `json-output`: the `--json` flag, the shape of the object on success and on failure, the error codes, what the flag silences, and the published JSON Schema of the object.

### Modified Capabilities

None. `json-output` states that it takes precedence over the output rules of `ask-question` when the flag is on; those rules stay true without it.

## Impact

- `packages/cli/src`: `args.ts` (flag), `cli.ts` (usage, output and failure routing), a new module that builds the object and maps errors to codes, and the presenter, which stays quiet under the flag.
- `README.md`, `docs/src/content/docs/ask-a-question.md`, a new docs page for the output and the schema file the site serves.
- `release-please-config.json`: the schema file is an extra file, so a release rewrites its `$id`.
- A `schema:generate` script. One new dev dependency, a JSON Schema validator, used by tests only. Minor version bump (`feat:`).
