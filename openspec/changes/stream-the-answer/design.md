# Design

## Context

`ask.ts` sends one request, waits for the whole response and returns an `Answer`. `run` prints it. The retry loop wraps that single call, and one 60 s abort signal covers it. Requirements are in `specs/ask-question/spec.md`; motivation is in `proposal.md`.

What the SDK offers, read from its types (1.4.25): `chat.send` with `chatRequest.stream: true` returns an `EventStream<ChatStreamChunk>`, a `ReadableStream` with an async iterator. Each chunk has `choices[].delta.content` (answer text), `choices[].delta.reasoning` (readable thinking), `delta.reasoningDetails` (a union that includes encrypted and summary forms), the served `model`, an optional `usage` with `completionTokensDetails.reasoningTokens`, and an optional `error { code, message }`. The live recording of the non-streamed call showed a reasoning model spending 11 of its 16 completion tokens on thinking.

One live streamed call was recorded (task 1.2, done early with the user's permission; free model, short question, `nock` recorder, body only). It showed:

- The body is SSE: `data: {json}` lines separated by blank lines, ending with `data: [DONE]`. No comment or keepalive lines appeared in this short run. Longer or slower requests may differ; the first-chunk timer is therefore not told to restart on comment lines unless a later recording shows them.
- Thinking arrives first as `delta.reasoning` with `reasoningDetails[0].type` of `reasoning.text`, then answer text as `delta.content`. Chunks carry `content: ""` while the model is still thinking.
- Usage arrives in its own last chunk, after the chunk with `finish_reason: "stop"` and before `[DONE]`. The served model is on every chunk.
- Reasoning tokens can exceed completion tokens: the usage read `122` completion and `128` reasoning. The provider counts them its own way, so the `tokens:` line prints the numbers as reported and does not assume reasoning is a part of completion.
- All 40 chunks arrived within about 10 ms, 1.8 s after the request. This model delivers the stream in one burst, so for it streaming moves no latency; it only keeps the behavior correct for providers that do stream steadily.

Two spikes (tasks 1.1 and 1.3, run in the scratchpad against the recorded body and a local server) settled the rest:

- `nock` serves an SSE body well. A reply function that returns a `PassThrough` lets the test push chunks when it chooses; the SDK's event stream hands them to the consumer one by one, and a consumer saw the first three before the rest was pushed. But aborting a request while `nock`'s mock socket is open crashes undici with an assertion (`assert(!this.aborted)`), and vitest reports it as an unhandled error. Tests of anything that aborts therefore use a real local `http` server, as the existing timeout test does.
- The SDK accepts a caller's `signal` in the request options (and then ignores its own `timeoutMs`). But once the stream is open, aborting that signal does not end or fail the stream's iterator: the loop hangs forever. A `TypeError: terminated` is what a dropped connection produces instead; it is not one of the SDK's error classes. An error chunk arrives as an ordinary chunk with an `error` field.

## Goals / Non-Goals

**Goals:**

- Answer text reaches stdout as it arrives, through `run`, in an in-process test that paces the chunks.
- One place decides what is written where, and one place handles failures, as now.
- The retry rule and the timeout rule stay testable without sleeping or waiting.

**Non-Goals:**

- No flag for turning streaming off.
- No spinner, no progress line, no wrapping or paging of long thinking.
- No handling of back-pressure from a slow reader of stdout. Node buffers the writes.

## Decisions

### `ask` becomes an async stream of events

`ask` stops returning an `Answer` and yields events instead:

```
{ kind: 'thinking', text }   readable reasoning text
{ kind: 'content',  text }   answer text
{ kind: 'done', model, usage }   after the last chunk
```

It is an async generator. Failures throw `ApiError`. What counts as a failure, which failures are transient and what their messages say live in `failures.ts`, apart from the stream reading and the retry loop in `ask.ts`; the two change for different reasons. The alternative is a callback (`ask(config, question, onEvent)`), which would let `ask` push without a consumer loop. A generator keeps `run` in control of pacing and ordering, makes the "nothing written yet" test trivial (no event has been yielded), and needs no extra types. Rejected: an event emitter, which adds a second error path.

### Retry only while nothing has been yielded

The retry loop moves inside the generator. A failure is retried only if no event has been yielded yet and it is transient. The first yielded event closes the door, because from then on `run` may have written to a stream. This is the rule in the spec, "no retry after output has started", expressed as one boolean. Thinking counts as output even when it is hidden: a retry would repeat nothing visible, but treating all events alike keeps the rule simple and avoids a stream whose second attempt thinks differently from the first. An error chunk with a 429 or 5xx code before any event is treated like the same HTTP status.

### Timeouts: first chunk and gap, not total

The SDK's `timeoutMs` is an `AbortSignal.timeout` on the whole request and would cut a long answer, so the generator passes its own `AbortController` signal instead, which switches the SDK's deadline off. The idle limit is enforced by racing each wait against a timer: one race around the request until the response arrives, then one around every `iterator.next()`. When the timer wins, the wait ends with an `IdleTimeout`, which becomes an `ApiError` that says the request timed out. The race is what ends the wait, because the SDK's iterator ignores an abort; "Releasing the connection" below says how the socket is freed. The limit is a parameter (`idleTimeoutMs`, 60 s by default, replacing `timeoutMs`), so tests wait a few hundred milliseconds, not a minute. A steady stream that takes longer than the limit in total is never cut. The spike confirmed all of it: stall after chunks, silence before the response, and a steady stream of about 850 ms against a 150 ms limit.

Any error thrown while the generator is waiting on the stream after it opened (a dropped connection, for one) is a stream failure and becomes an `ApiError`, whatever its class. The exception is a malformed chunk: the SDK lets a bare `ZodError` escape for it, with a long multi-line message. That is recognised as a shape error, reported in one fixed line, and not retried, because sending the same request again would return the same malformed data.

### `run` writes, `present.ts` formats

A small module, `present.ts`, turns events into writes. It holds the facts about the terminal and nothing else:

| Event | Writes |
| --- | --- |
| thinking, shown | stderr: the text, dimmed or plain |
| first content after thinking | stderr: reset, newline; stdout is a terminal: one more blank line |
| content | stdout: the text |
| end of stream | stdout: one newline (only if text was written); then `done` is turned into the status lines |

`run` owns the failure path. When a failure arrives after output has started, `present.ts` is asked to close the line (a newline on stdout if text was written; a reset and newline on stderr if thinking was left open), and then `run` writes the error line as it does today. Splitting formatting from the failure policy keeps each testable: `present.ts` with plain string-collecting streams, `run` with `nock` and pacing.

### Showing thinking: auto, with two flags

The user asked for thinking to be shown and confirmed this default: shown by default when stderr is a terminal, hidden when it is not, with `--thinking` to force it on and `--no-thinking` to force it off. The user's note: the rule is easy to follow once it is explained, so the docs carry the weight, with a table of where the output goes. Reasons: a person watching a terminal wants to see the wait explained; a log or a pipeline did not ask for reasoning and gets none. The alternatives are always shown (predictable, but noisy in logs) and hidden unless asked (conservative, but the silent wait stays). The usage guide must explain "stderr is a terminal" in plain words, with the redirect examples that change the outcome.

`run` needs two new facts: whether stdout and stderr are terminals, and the value of `NO_COLOR`. `Io` gains `isTTY` on `stdout` and `stderr`. `NO_COLOR` is read from the real environment that `run` receives, as the convention has it; a `.env` file is not consulted for it.

### Key redaction: messages, not model text

`run`'s catch keeps redacting the key from every message the CLI writes. Model text is not redacted. The model never receives the key, so it cannot echo it, and a streaming redactor would have to hold back the last `key length - 1` characters of every chunk to catch a key split across two. That delays output for a case that cannot occur. The spec says so: the guarantee covers messages the CLI writes. This narrows the earlier wording ("no output"). The user confirmed it. The one way a model could print the key is a question that contains it, which the user typed.

### Releasing the connection

`readChunks` owns the request and lets go of it however it ends. When it abandons a stream (a failure, or a consumer that stops early), it cancels the reader in a `finally`; on a stream that ended by itself that does nothing. When a wait times out, it also aborts the request's controller, because a stalled read ignores everything but the abort, and the abort is what closes the socket. The first chunk counts its wait from the moment of sending, so a slow response does not stretch the first-chunk limit to twice its value. A request that failed with an HTTP error has nothing to let go of: the SDK has already read that response.

One value is not guarded: the served model name, which the API supplies, is printed in the `model:` line as received. Redaction covers the messages the CLI composes, and the model name is model-side text like the answer.

### Status: reasoning count

`status.ts` reads `usage.completionTokensDetails.reasoningTokens`. A missing or zero count leaves the line as it was. `types.ts` gains an optional `reasoningTokens` on `Usage`.

### Tests

The fixture is the recorded SSE body. Realistic cases (thinking, then answer, then usage) use it as it is. Cases that need exact content, such as `4` then `2`, or an error chunk after `Hel`, build their bodies from a small helper that formats chunks as SSE events.

Two kinds of test double serve two kinds of test. `nock` serves the tests that only send a request and read a response to its natural end: the request itself, HTTP errors, retries on a status code (`ask.test.ts`). Everything that opens a stream and then abandons, cuts or stalls it runs against a real server on `127.0.0.1` (`test/fakeApi.ts`, used by `ask.stream.test.ts` and `ask.integration.test.ts`; `nock` is not imported in those files). The reason is measured, not assumed. Cancelling a response that `nock` has delivered makes undici throw a `TypeError` from its socket error handler a moment after the test, which vitest reports as an unhandled error and, in the integration suite, which killed the worker in about 40% of runs. A plain vitest config showed the same, so it is not a matter of filtering. The standalone script that used real sockets hung up correctly 25 times in 25. The suite on real sockets ran clean 30 times in 30.

The fake API answers a queue of canned responses and records the requests. A test can also hand it a stream to feed by hand, which is how "first text appears early" is proved: push one chunk, assert what `run` has written, push the rest. It needs a test-only hook beside the idle limit already on `ask`: `run` takes an optional `serverURL` in its `io` and passes it to `ask`; the real entry point never sets it. Tests that need full control of a response (hold it open, cut it) start a bare server through the same `listen` helper in `fakeApi.ts`. Mocks served through `nock` leave out the closing `data: [DONE]` line, because after it the SDK cancels the rest of the response and trips the same artifact. The recorded fixture and the loopback tests keep the line, so the real ending is covered. Retry waits are mocked through `node:timers/promises`.

The first request through the SDK in a process pays a start-up cost of tens of milliseconds. The tests with a 300 ms idle limit warm the SDK up first, so the limit measures the server and not the process.

## Risks / Trade-offs

- **Partial output is now possible on failure.** → The spec says it plainly, ends the line, sets exit 2. A script that needs all-or-nothing checks the exit code.
- **A reasoning model may show a very long thinking stream.** → It goes to stderr only, hides in pipes, and `--no-thinking` stops it. Truncation is out of scope.
- **Some providers send no readable thinking.** → Nothing prints and the wait stays quiet. The `tokens:` line still shows the reasoning count.
- **The SDK's iterator ignores an abort.** → Settled by the spike: the idle limit is a race in our own loop, and the abort only frees the socket.
- **Keepalive comments in the SSE stream** (OpenRouter documents `: OPENROUTER PROCESSING` lines) **may reach the iterator or be swallowed by the SDK.** → None appeared in the recording. If a later run shows them being swallowed, a long silent stretch before the first token could trip the first-chunk timer; then the timer must restart on them.
- **Usage might not arrive in the last chunk for every provider.** → It did in the recording. Missing usage is already a defined failure (exit 2, answer kept).
- **Some providers buffer the stream and deliver it in one burst.** → The recorded free model did. Nothing breaks, but the user sees no gain from streaming on such a model. The docs should not promise otherwise.
- **A key echoed right at the 200-character cut of an API message could escape redaction in part.** → Messages are shortened before `run` redacts them, so a key that straddles the cut would print as a prefix that does not match. The key would have to be echoed by the API at exactly that position; accepted and noted here.
- **More surface for the next slices.** → The event type is the seam Langfuse needs. The Langfuse slice wraps the generator rather than editing it.
