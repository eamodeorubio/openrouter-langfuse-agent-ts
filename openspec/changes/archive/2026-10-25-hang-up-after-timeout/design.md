# Design

## Context

`readChunks` in `src/chat.ts` creates one `AbortController` per request and passes its signal to `client.chat.send`. When the idle limit passes, or the stream fails, it calls `abort()` and abandons the SDK's iterator, which ignores aborts. The abort is the only thing that frees the socket. See proposal.md for why it sometimes does not.

The SDK's `_do` clones the request it built, and `fetch` makes a third `Request` from the clone. Each link in that chain follows the previous signal through a weak reference. After the response head arrives, nothing holds the first two, so a collection can free them and cut our `AbortController` off from the fetch. The tools' lookups pass no signal; they set a deadline instead, and the SDK builds its own timeout signal for them.

## Goals / Non-Goals

**Goals:**
- `abort()` reaches the socket however long the response has been open.
- The change is small, local to the SDK client, and testable with a forced collection.

**Non-Goals:**
- Replacing the SDK, or the `fetch` it uses.
- Changing how lookups time out.
- Making the process exit sooner for any other reason.

## Decisions

**Hand the signal to `fetch` ourselves.** An experiment over 40 runs with a forced collection, against a local server:

| How the request is made | Hung up |
| --- | --- |
| plain `fetch(url, { signal })` | 40/40 |
| the SDK as it is | 0/40 |
| the SDK, fetcher keeps the final `Request` alive | 0/40 |
| the SDK, fetcher calls `fetch(request, { signal: ours })` | 40/40 |

`fetch` holds the `Request` it makes for as long as its response is open, so a signal given to `fetch` directly stays linked. The SDK takes a custom `HTTPClient` with a `fetcher`; ours calls `fetch(request, { signal })` with our signal in place of the one the chain derived.

**Carry the signal in an `AsyncLocalStorage`.** The fetcher belongs to the client, which is shared by every request of a run, and the signal belongs to one request. `chat.ts` runs `client.chat.send(...)` inside `withSignal(controller.signal, ...)`; the fetcher reads the store. Context follows the SDK's `await` chain, so the fetcher sees the signal of the call that led to it, and concurrent requests do not see each other's. A request made outside any context, a lookup, calls plain `fetch(request)` and keeps the signal the SDK gave it, deadline included.
*Alternatives:* a header that names the request, with a registry the fetcher reads (it puts an internal detail on the wire path and needs cleanup); a client per request (changes the signature of `ask`, `chat` and the tools); keeping every `Request` alive (measured: does not work, since the first link is out of reach); dropping the SDK for `fetch` (a large change for a small defect).

**One channel, in the client module.** `src/client.ts` exports `createClient`, `withSignal` and the fetcher `fetchWithSignal` (exported so that tests can call it), and owns the store. `chat.ts` imports `withSignal` and nothing else changes in its logic.

**The test forces the collection.** A real collection is rare enough that the defect showed 1 time in 4 under load, and never on a quiet machine. The test runs a collection between the first chunk and the idle limit, which made the old code fail every time in the experiment. It gets `gc` without a command-line flag: `test/gc.ts` turns the V8 flag on from inside (`v8.setFlagsFromString('--expose-gc')`) and reads the function from a fresh context (`vm.runInNewContext('gc')`). The flag in vitest's `execArgv` was tried first and fails where it matters: Stryker's runner uses worker threads, and Node refuses `--expose-gc` for a thread, so its first run would stop before any test. The helper throws when V8 gives no function; the test never skips.

## Risks / Trade-offs

- [A future SDK version stops calling the custom fetcher, or changes how it builds requests] → The collection test fails, and CI stops before a user meets the hang. It pins the behavior.
- [`AsyncLocalStorage` context lost across an SDK await] → The unit test makes a request through the real SDK client inside `withSignal` and checks that the signal reaches `fetch`; the collection test covers the end to end path.
- [The lookups' own deadline is built the same weak way] → Measured: 20 of 20 lookups against a silent server timed out with the SDK's `RequestTimeoutError`, with a forced collection and without. The link breaks only once a response has begun, and a lookup is read in full at once. Not changed.
- [A future Node removes the way the helper gets `gc`] → It throws, and the collection test fails loudly. It does not skip.

## Migration Plan

Ships in the next release, as a patch. No change for users except that a timeout can no longer leave the process waiting for the server.
