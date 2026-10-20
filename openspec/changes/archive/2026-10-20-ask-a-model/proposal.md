# Proposal

## Why

The CLI does nothing yet. `src/index.ts` exports a constant. Every later piece, the agent loop, the cost advice, the Langfuse traces, needs a working path from a question to an OpenRouter model and back. This change builds that path with one call and no agent around it.

It also settles contracts that later slices inherit: where input comes from, how the model is chosen, what goes to stdout and stderr, and which exit code means what.

## What Changes

- A user asks a question with `-q "text"` or through stdin, and the CLI prints the model's answer on stdout.
- The model comes from `--model`, or else from `OPENROUTER_MODEL`. There is no default. A missing model is a configuration error.
- The API key comes from `OPENROUTER_API_KEY`. A missing key is a configuration error.
- Two status lines go to stderr: the model that served the request, and the token usage (prompt, completion, total).
- Exit codes: 0 on success, 1 for usage and configuration errors, 2 for API failures and unusable responses.
- A `.env` file in the current directory is loaded if present. Variables already in the environment win.
- `@openrouter/sdk` makes the call. This is the client only; `@openrouter/agent` stays out.
- `.env.example` gains `OPENROUTER_MODEL`. The README documents usage.

Not in this change: steps and trace link in the status output (they wait for the agent loop and Langfuse), cost from `usage.cost`, a system prompt.

## Capabilities

### New Capabilities

- `ask-question`: answering one question with one OpenRouter model. Covers input sources, model and key resolution, output streams, status lines and exit codes.

### Modified Capabilities

None.

## Impact

- New code in `packages/cli/src/` and tests in `packages/cli/test/`. `index.ts` becomes thin wiring.
- New runtime dependency: `@openrouter/sdk`. `pnpm add` asks for approval.
- `.env.example`, README and the docs site usage page change.
- One `feat:` product slice. It would mint `v0.1.0` through release-please.
