# Proposal

## Why

The agent calls a model, runs tools, and spends money, and nothing records what happened. When an answer is wrong or a run is dear, the only evidence is the terminal scrollback. A cost-hunting agent that cannot show its own token counts and costs per request, per tool call and per run is hard to trust and hard to tune.

Langfuse is the tracing backend the project chose from the start. The SDK that fits is its OpenTelemetry-based one, JS/TS v6.0.2. An earlier draft of this plan named v5. The npm `latest` tag is 6.0.2, it needs Node 22 or later (the repo requires 26) and Langfuse Cloud or a self-hosted server from 4.59.0.

## What Changes

- Tracing switches on when `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` are all set, in the environment or in `.env`. With none of them set the CLI runs untraced and writes one warning to stderr. With some of them set, it fails with a configuration error.
- A traced run checks the credentials against Langfuse before it asks the model anything. A rejection or an unreachable server is a plain error, not a silent loss of data.
- Each run becomes one trace. Its root is an `agent` observation holding the question and the final answer. Each request to the model is a `generation` with the messages sent, the reply, the thinking, the token counts and the cost. Each tool call is a `tool` observation, a sibling of the generation that asked for it.
- The trace id is known and can be shown on stderr with `--verbose`. The trace context travels to OpenRouter as W3C `traceparent` on every request.
- Everything sent to Langfuse passes one masking function. API keys, bearer tokens and email addresses never leave the process.
- The CLI flushes before it exits, on every path, within a bounded wait. A failed flush is an error; it does not hide an earlier one.
- Low-cardinality discipline is **not** a goal here. Full prompts, responses, counts and costs are the point. Observation names stay stable and verb-first, and run-specific values go into metadata.

## Capabilities

### New Capabilities

- `tracing-setup`: when tracing is on or off, the credential check, the warning, the trace id, context propagation, flushing and the failure rules.
- `trace-content`: the shape of the trace: observation types, nesting, names, inputs, outputs, usage, cost, levels, metadata, and masking.

### Modified Capabilities

- `ask-question`: *Verbose flag* also turns on the trace id line. The new specs cite its environment file and exit codes and change neither.

## Impact

- `packages/cli/src`: a new `tracing` module (setup, masking, flush), wiring in `cli.ts` and `ask.ts`, one observation per round in `chat.ts` and per call in `turn.ts`, the `traceparent` header in the request options of `chat.ts` and the two tools that call the SDK. `Usage` gains the cost and cached-token counts the API already returns.
- Dependencies: `@langfuse/tracing`, `@langfuse/otel` and the OpenTelemetry packages they need (`api`, `core`, `resources`, `sdk-trace-base`, `sdk-trace-node` and the OTLP exporter), all at the versions the design pins.
- `.env.example` already lists the Langfuse variables; the usage guide and README describe the new behavior.
- Tests stay offline: `nock` for Langfuse, an in-memory span exporter for the tree, the local server for cancelled streams.
- Bump: minor (`feat:`).
