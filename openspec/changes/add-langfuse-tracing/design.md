# Design

## Context

`ask` is an async generator that yields events to the presenter. `chat` is a second generator, one per round, with retries inside it. Tools run in `runCalls` under `Promise.all`. The OpenRouter client is built by `createClient`, whose `HTTPClient` offers a `beforeRequest` hook. Configuration is read once in `loadConfig`. See proposal.md for the motivation.

Langfuse's JS/TS SDK is OpenTelemetry underneath. Version 6.0.2 is the pin. The SDK overview page still says v5; the upgrade page and the npm `latest` tag say v6, and I follow those. Three v6 facts shape the design: trace input and output come from the root observation (`setActiveTraceIO` is gone); metadata values are JSON-encoded on the span; the `mask` option of `LangfuseSpanProcessor` sees input, output and metadata as strings.

## Goals / Non-Goals

**Goals:**
- One place decides, sets up and tears down tracing. The rest of the code sees a small interface and never imports Langfuse.
- A run without tracing runs the same code path with a no-op tracer, so behavior cannot drift between the two.
- The tree in `trace-content` is exact enough to assert in a test against an in-memory exporter.

**Non-Goals:**
- Scores, prompts management, datasets, sessions, users. The CLI has no conversation and no accounts.
- Sampling. Every run is traced.
- Tracing the tools' HTTP requests as observations.

## Decisions

**A `Tracer` interface in `src/tracing/`, with two implementations.** `createTracer(env)` returns the Langfuse one or a no-op one. The interface has `run(question, work)` (root), `generation(input)`, `tool(call)` and `flush()`. The loop calls the interface only. Three reasons. Only this module imports `@langfuse/*` and `@opentelemetry/*`, so a change in the SDK lands in one place. A traced and an untraced run execute the same loop, with no `if (tracing)` at the call sites. And *Tracing never changes the answer* is enforced once, in the wrapper, instead of by a `try`/`catch` at every site. Alternative: call `@langfuse/tracing` directly in `ask.ts`, `chat.ts` and `turn.ts`. Rejected for those three reasons. The interface does not help mutation testing much: the survivors in names and attributes die only to tests that read the exported spans, wherever the calls live, and the no-op tracer brings equivalent mutants of its own.

**A provider of the tracer's own, not `NodeSDK`.** `NodeSDK` registers OpenTelemetry globals, which a second run in the same process (every test) cannot do twice. The tracer builds a `NodeTracerProvider` with the `LangfuseSpanProcessor` and hands it to `setLangfuseTracerProvider`; nothing is registered globally, and the package list drops `sdk-node` for `sdk-trace-node`. This is the pattern Langfuse documents for isolated providers.

**One redactor.** `createRedactor` lives in `text.ts` and takes the marker. The stderr and tool-result paths use `[redacted]`, the trace uses `[REDACTED]`; both replace a secret plain and as JSON escapes it, longest first. The processor's `mask` walks a decoded value, keys and strings, instead of redacting JSON text, because a secret such as `n` would otherwise break the JSON. The mask does not reach a status message or an observation name, so the tracer redacts those itself.

**Interrupts.** `run` takes an `AbortSignal`. When it aborts, the tracer ends every open observation as an error and refuses new ones, `run` flushes and returns 130 or 143, and `index.ts` exits, which ends the loop that is still running. A root that ends while a call is open, as when one of several parallel tools throws, ends that call too, so that it is exported.

**Manual observations, explicit parents, not `startActiveObservation`.** `startActiveObservation` scopes the active span to a callback. Our spans open and close across `yield`s of an async generator, and `Promise.all` starts tool calls together. A callback would end the span at the first yield or lose the context. So the root is made with `startObservation(..., { asType: 'agent' })`, children with `root.startObservation(..., { asType })`, and each ends in a `finally`. The OTel context is made active only around the code that issues an HTTP request (`context.with`), which is what the `traceparent` hook reads. Alternative: `AsyncLocalStorage` over the whole generator. Rejected: generators resume in the caller's context, so it would silently misparent.

**Root id from `createTraceId`.** The root takes a fresh random seed through `createTraceId`, and the id is read back with `getActiveTraceId`. The CLI does not try to derive it from the question: the question may be secret, and a repeated question is a new run, not the same trace.

**Preflight with one `GET /api/public/projects`.** It uses Basic auth with the two keys, a 10 s timeout and plain `fetch`. 2xx is success. This is a documented public endpoint that answers 401 for bad keys, so it proves both the URL and the keys without the extra dependency of `@langfuse/client`. The check runs inside `createTracer`, before the question is read. In tests `nock` answers it. Verify against the API reference in task 1.1 before relying on the path.

**Exit codes.** Missing or partial variables and a malformed URL are configuration errors: exit 1, like `OPENROUTER_API_KEY`. A rejected key, an unreachable server and a failed flush are failures of an external service: exit 2, like an API failure. A flush failure never lowers an existing code. This is my reading of the request ("plain error if something is wrong with Langfuse"); the user confirms it at spec approval.

**One masking function, applied at the processor.** `LangfuseSpanProcessor({ mask })` is the single choke point, so no observation can skip it. The function runs the key list (both Langfuse keys and the OpenRouter key, read from the environment) as literal replacements first, then the patterns for key shapes, bearer tokens and emails. The existing `redactKey` stays for stderr. The model still sees the original text; only the export is masked. Alternative: mask when building each observation. Rejected: it relies on every call site remembering.

**Generations are made in `chat`, one per request, with retries counted inside.** The generation opens before the first attempt and closes after the last, so a retried request is one generation with `retries` in metadata. `chat` already knows the first-chunk moment and the failure, so the two `event` observations are made there. Usage, finish reason, model and thinking come from the `Round`, which gains `finishReason` and the thinking text.

**`Usage` grows.** It carries the API's `cost` and the cached prompt tokens. The buckets are computed once, in `usage.ts`, as exclusive counts, because Langfuse stores each key as a separate bucket. A property test states that they sum to the total.

**Context to OpenRouter in the request options.** Each generation and tool span knows its trace id and its own span id, and gives the `traceparent` for them: `00-<trace id>-<span id>-01`, the form the W3C standard sets, with the sampled flag on. `chat` passes it as `headers` in the options of `chat.send`, and each tool passes it in the options of `models.get` and `models.list`; `ToolContext` carries the per-call options, so two parallel calls cannot swap headers. A spike against a local server showed the SDK sends `headers` from `RequestOptions` on all three calls. There is no hook, no store and no global state, and the data flow reads in the code. The cost is that a tool added later must pass the options on, or its requests go out untraced; the integration test names each kind of request so that a gap shows. An untraced span gives no header. OpenRouter will probably ignore the header; it costs nothing, and it is what makes a later proxy or gateway join the trace. Alternative: an `AsyncLocalStorage` holding the active span, read by a `beforeRequest` hook on the client. It covers every future call by construction, at the price of hidden state; with three call sites that was not worth it.

**Flush on every exit.** `run` wraps its body in `try`/`finally`, and the entry point installs SIGINT and SIGTERM handlers that end the open observations with an error level and then flush. `flush()` is `forceFlush()` on the span processor raced against 10 s, then `shutdown()` of the SDK. The SDK is imported dynamically, after `loadConfig`, so it never initialises with missing credentials.

**Where the details enter.** The tracer is built once, in `run`, with the app version, and stamps every observation it creates, so no call site passes it. The other details come from the code that knows them:

| Detail | Source | Set by | On |
| --- | --- | --- | --- |
| App version | `version` of `packages/cli/package.json`, read once at startup | the tracer, at creation of each observation | every observation, as `version` |
| Release | `LANGFUSE_RELEASE`, else the app version | the SDK, from the environment; the CLI fills the default | the trace |
| Environment | `LANGFUSE_TRACING_ENVIRONMENT` | the SDK | the trace |
| Requested model | `config.model` in `ask` | `tracer.generation({ requestedModel })` when the generation opens | generation metadata `requested_model` |
| Served model | `Round.model` | the generation's closing update | generation `model`, the field Langfuse prices by |
| Usage, cost, finish reason, thinking | `Round` | the generation's closing update | generation |
| Retries, round index | `chat`, `ask` | `generation` metadata | generation |

On a failed request there is no served model, so `model` falls back to the requested one. The version is read with `readFile(new URL('../package.json', import.meta.url))` and checked for a string `version`: `package.json` lies outside `rootDir: src`, so an `import` would break the build, and the file sits one level above both `src/` and `dist/`. release-please bumps it, so the trace never lags the release. Stamping in the tracer, and not through `propagateAttributes`, is deliberate: propagation rides the active OTel context, and our observations are parented explicitly. Task 1.1 showed that children inherit propagated attributes only when they are created inside the `propagateAttributes` callback. Ours are created later, across generator resumes, so they would miss them. The stamp stays in the tracer.

**Packages.** The `@langfuse/otel` peers pin the OpenTelemetry 2.x generation, so the pins are `@opentelemetry/api` 1.9.1, `core` and `sdk-trace-base` 2.12.0, and `sdk-node`, `exporter-trace-otlp-http` and `otlp-exporter-base` 0.223.0. The newest line (core 3.0.0, `sdk-node` 0.300.0, `api` 1.10) conflicts with those peers. `LangfuseSpanProcessor` accepts a custom `exporter`, which the tests use to read the exported spans; its default exporter posts to `{base}/api/public/otel/v1/traces`, so `nock` can stand in for Langfuse.

**Usage buckets.** Langfuse stores every key of `usageDetails` as its own bucket, so a token must sit in exactly one. Cached prompt tokens and reasoning tokens are taken out of `input` and `output`. The recorded stream in the test fixtures shows why the rule needs a guard: that provider reports 25 prompt tokens, 122 completion tokens and 128 reasoning tokens, with a total of 147. The reasoning count exceeds both the completion count and the total, so it cannot be a part of either. The tool trusts prompt, completion and total, and keeps the odd count where a reader can still see it, in metadata. `total` is the sum of the buckets, not the provider's figure, so the sums hold. Cost is the API's own `cost`, sent as `costDetails.total`, so the trace does not depend on Langfuse knowing the price of the model.

**Stream events.** An `event` is made from the generation handle and ends at once. `receive-first-token` fires at the first chunk of text or thinking; `fail-stream` fires only for the failure that ends the request, not for an attempt that is retried, since the retry count already says so. Both are reported through the `RoundObserver` that `chat` already takes, next to `retried`.

**Masking beyond the keys.** The trace's redactor also replaces, by pattern, bearer tokens, strings shaped like OpenRouter and Langfuse keys, and email addresses. The patterns apply after the literal keys, to every string the mask and the tracer redact. They are deliberately few and tight: false positives cost a little readability, false negatives cost a leak, but a broad pattern would also eat tool results, which are the evidence a trace exists to keep.

**What the SDK gives (checked in v6.0.2).** An observation made with `asType: 'event'` ends itself when it is built, so an event needs no `end()`. `usageDetails` and `costDetails` are written to `langfuse.observation.usage_details` and `langfuse.observation.cost_details` as JSON, so the buckets are plain keys and `total` is one more key. A handle carries `traceId` and `id` (the span id), which is all `traceparent` needs.

**Version.** A small module reads `version` from `package.json` once, when tracing starts, and the tracer stamps it on every observation. The release defaults to it.

## Risks / Trade-offs

- [The span processor could swallow export errors, so a failed export would look like success] → Settled in task 1.1 by a spike against a local server: `forceFlush()` rejects on 500, on 401 and on a refused connection (the last after about 4.4 s of retries, inside the 10 s bound), and resolves on 200. No fallback read is needed. The flush step treats a rejection as the failure.
- [Full prompts and answers go to a third party] → Masking covers keys, tokens and emails only. Names, addresses and other free-form personal data in a question are exported. The usage guide says so. A switch to drop content is out of scope until someone asks.
- [Version drift between docs and package] → Pin exact versions of all `@langfuse/*` and `@opentelemetry/*` packages, and read the v6 pages, not the overview, when in doubt.
- [Mutation testing on `src/tracing`] → Equivalent mutants in the no-op tracer are likely; they follow the AGENTS.md rule of rewrite first, disable with a reason second.
- [Stryker has no TypeScript checker] → Mutants that stop compiling can survive; they count as equivalent with that reason.
- [Doubled work on the stream path] → The generation records text after the stream ends, not per chunk, so the hot path adds nothing but one `event`.

## Open Questions

- Does the trace URL deserve a line with `--verbose` next to the id? It needs the project id, which the preflight response may hold. Deferred; the id alone is enough to find the trace.
