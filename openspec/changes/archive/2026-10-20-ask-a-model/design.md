# Design

## Context

The package is empty: `src/index.ts` exports a name and one test checks it. The behavior to build is in `specs/ask-question/spec.md`; motivation is in `proposal.md`.

Three constraints from AGENTS.md shape the design. Tests never touch the network, so every request must be interceptable by `nock` inside the test process. Results go to stdout and diagnostics to stderr. Stryker mutates `src/` and ignores thin wiring, so wiring must hold no logic.

The SDK's call name, error classes, `usage` shape and `nock` compatibility are not yet verified. The first task is a spike that settles them. Decisions below that depend on the answers are marked.

## Goals / Non-Goals

**Goals:**

- Every requirement in the spec is reachable by an in-process test with injected argv, env, stdin and output streams.
- Failure handling lives in one place.
- The SDK appears in one module. Nothing else imports it.

**Non-Goals:**

- No abstraction for "other providers" or other call styles. One call, one function.
- No retry of timeouts, of other 4xx statuses or of unusable responses, and no `Retry-After` handling.
- No streaming.

## Decisions

### Layout

```
index.ts   wiring: process.* -> run()          (excluded from mutation)
cli.ts     run(argv, env, io) -> exit code     orchestration, usage text, one catch
args.ts    parseArgs wrapper                   -> { question?, model? } | UsageError
config.ts  env validation, .env merge          -> { apiKey, model } | ConfigError
input.ts   question from -q or stdin           -> string | UsageError
ask.ts     the only SDK importer               -> { answer, model, usage } | ApiError
status.ts  formats the two status lines
errors.ts  UsageError, ConfigError, ApiError   (reason only, no text of their own)
```

`run` takes `io = { cwd, stdin: { isTTY, read() }, stdout, stderr }` and returns the exit code. It never calls `process.exit`. `index.ts` passes `process` streams and sets `process.exitCode`. The in-process integration test drives `run` with `nock` in place of the network.

The alternative is a subprocess test through `tsx`. It exercises the real entry, but `nock` cannot reach into a child process, so it would need a fake server on a port. Rejected: slower, and it adds a second mocking mechanism.

### One catch, three error types

`UsageError` and `ConfigError` map to exit 1; `UsageError` also prints the usage text, which lives in `cli.ts` with the other presentation. `ApiError` maps to exit 2. `run` catches them in one place, writes to stderr and returns the code. Any other exception is a bug. The same catch reports it as `Unexpected error: <message>` and returns 2, so `index.ts` holds no logic. Messages are built from our own text and the SDK's error message. `run` replaces the key with `[redacted]` in every message it writes to stderr, whatever failed, once the config is loaded, in case a server or an exception echoes it back. That single boundary is pinned by tests for an API message, a plain-text body and an unexpected error.

### Order: args, then environment, then stdin

Matches the spec. A missing key must not hang on an open pipe, so stdin is the last thing read. `input.ts` receives the stream only after config has passed.

### Loading `.env`

The request named `process.loadEnvFile()`. That function writes into the global `process.env`, which leaks between in-process tests. Instead `config.ts` reads `./.env` with `node:fs`, parses it with `util.parseEnv`, and returns a merged object in which the real environment wins. The behavior matches `loadEnvFile`; the difference is that it takes `env` and a directory as arguments, so tests use a temporary directory and a plain object. A missing file is ignored; any other read error is a `ConfigError`.

### Model and key

`config.ts` returns `{ apiKey, model }`. Blank (empty or whitespace) counts as unset. `--model` beats `OPENROUTER_MODEL`. There is no default, so a fresh clone fails loudly rather than spending money on a model chosen in a constant. `OPENROUTER_MODEL` is the generation model only; later slices that need another model get their own variable.

### Calling OpenRouter

`ask.ts` creates the client with the key, takes optional `timeoutMs` and `serverURL` so tests can point it at a local server that never answers, and calls `client.chat.send({ chatRequest: { model, messages: [{ role: 'user', content: question }] } })`. Spike findings (SDK 1.4.25):

- The response uses camelCase: `choices[0].message.content`, `model`, `usage.promptTokens`, `usage.completionTokens`, `usage.totalTokens`.
- The SDK's own validation accepts an empty `choices`, a missing `usage` and `content: null`. `ask.ts` checks those itself: `content` must be a non-empty string and `usage` must be present. The SDK already rejects a `usage` object that lacks any of its three counts, so `ask.ts` does not check them again. Anything else is an `ApiError`.
- HTTP error statuses throw `OpenRouterError` subclasses (`UnauthorizedResponseError`, `InternalServerResponseError`, and `OpenRouterDefaultError` for non-JSON bodies). All carry `statusCode` and a clean `message`. Network failures throw `ConnectionError`, timeouts `RequestTimeoutError`; both extend `HTTPClientError`. A body that fails the SDK's schema throws `ResponseValidationError`, whose `cause` is a long `ZodError`. `ask.ts` maps all of them to `ApiError` and never prints the cause.
- `chat.send` retries by default: exponential backoff, `maxElapsedTime` of one hour, connection errors included. A failing API would hang the CLI. `ask.ts` sets `retryConfig: { strategy: 'none' }` and `timeoutMs: 60000` and does its own bounded retry (see Retries), so a failure ends in seconds with exit 2.
- `nock` intercepts the SDK's `fetch` transport. Test fixtures must be complete: the SDK's schema requires `system_fingerprint` (the live API sends `null`). The success and 401 fixtures in `test/fixtures/` are real responses recorded once with nock's recorder: bodies only, headers dropped. Error variants (no choices, no usage) are derived from the recording by overriding fields.

`@openrouter/sdk` over the OpenAI SDK: it is the first-party client, has one dependency, and needs no compatibility layer. The cost is that the Langfuse slice will wrap generations by hand, since Langfuse's drop-in wrapper targets the OpenAI SDK. Acceptable; the wrapper would only cover the call we already isolate in `ask.ts`.

### Retries

The SDK's own retry cannot express the policy in the spec. Its first wait is `initial × 0^exponent`, which is zero, with up to one second of jitter added; it stops by elapsed time, not by count; and by default it retries `5XX` only, never 429. `ask.ts` turns it off (`strategy: 'none'`) and runs its own loop: 4 retries, base wait `300 × 2^(n-1)` ms, scaled by `0.75 + random × 0.5`. It retries `OpenRouterError` with status 429 or at least 500, and `ConnectionError`. A timeout is not retried, because each attempt can already take 60 s. "4 rounds" is read as 4 retries after the first attempt; the constant is one line to change.

The loop sleeps with `setTimeout` from `node:timers/promises` and draws jitter from `Math.random`. Tests mock the module to record the waits without sleeping, and fix `Math.random`. That keeps the retry inputs out of the public signature of `ask` and `run`. The worst case adds about 4.5 s of waiting plus up to five attempts.

### Status lines

`status.ts` is a pure function from `{ model, usage }` to two lines. Format is fixed by the spec's example. It is split from `ask.ts` so that the later steps and trace-link lines can join it without touching the SDK module.

## Risks / Trade-offs

- **The SDK's response schema may reject a real response.** → Settled for the shape recorded: a live call returned `system_fingerprint: null` and the SDK accepted it. Other providers may differ; a mismatch exits 2 with a plain message.
- **Retries lengthen a failing run by up to about 4.5 s of waiting.** → Bounded by the count; timeouts are not retried, so the worst case stays near a minute per attempt only for a hung server.
- **Response shape drift.** → Validation in `ask.ts` turns any mismatch into exit 2 with a plain message instead of a stack trace.
- **Token counts of zero or missing for some providers.** → Missing is an error per the spec; zero is accepted.
- **Reading all of stdin has no size cap.** → Acceptable for a local CLI whose input the user supplies. Revisit if the tool ever runs unattended.
