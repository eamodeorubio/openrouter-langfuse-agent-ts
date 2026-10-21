# Proposal

## Why

Today the CLI prints nothing until the whole response has arrived. A model that writes two thousand tokens leaves the terminal blank for as long as it takes, and a reasoning model adds a silent stretch of thinking before the first word. The wait is real latency that the user can see and the tool can remove.

Streaming removes the second half of that wait: text appears the moment the model produces it. The first half, the thinking, is only visible if the tool shows it. Both belong to one change, because both rewrite the same output path and the same set of failure rules.

## What Changes

- The answer streams to stdout as it arrives. When the stream ends, one newline follows, as before. Streaming is always on; there is no flag.
- The model's readable thinking streams to stderr, never to stdout. It is dimmed on a terminal and honours `NO_COLOR`. By default it shows only when stderr is a terminal. `--thinking` forces it on and `--no-thinking` forces it off.
- The `tokens:` line adds the reasoning count when the usage reports one, for example `2024 completion (11 reasoning)`.
- A failure after output has started keeps the partial output on stdout, ends the line, writes one error line to stderr and exits 2. Before any output, failures behave as they do now.
- Retries run only before anything has been written. After that, a retry would repeat text the user has already read.
- The single 60 s deadline per attempt becomes two limits: 60 s to the first chunk and 60 s between chunks. A long answer is no longer cut at a minute.
- The key guarantee narrows to messages the CLI writes. Text the model generates, the answer and its thinking, passes through as received. The model never sees the key.

**BREAKING** (for scripts): stdout is no longer empty after every failure. A script that needs all-or-nothing output checks the exit code.

Out of scope: cost from `usage.cost`, Langfuse, the agent loop, a system prompt, showing encrypted or summary-only reasoning, a spinner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ask-question`: the answer, status, retry, failure and unusable-response requirements change; the key requirement narrows; thinking output, its flags, its style, stream timeouts and mid-stream failure are added.

## Impact

- `packages/cli/src/`: `ask.ts` becomes a stream of events; a new module writes them to stdout and stderr; `args.ts` gains two flags; `status.ts` gains the reasoning count; `cli.ts` wires the stream and the terminal facts (`isTTY`, `NO_COLOR`).
- Tests: a streamed success recorded once from the live API, plus a mid-stream error and a truncated stream derived from it. No dependency is added.
- Docs: the usage guide and the README.
- One `feat:` product slice. A minor bump on top of whatever the first release becomes.
