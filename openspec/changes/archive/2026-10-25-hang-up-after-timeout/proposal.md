# Proposal

## Why

When a model goes silent, the CLI gives up after 60 seconds, prints the error and abandons the request. It must also hang up, or the open connection keeps the Node process alive until the provider closes it. Most of the time it does. Sometimes it does not, and a test caught it: in Stryker's first run under load, the server saw the connection close 11 seconds after the CLI had called `abort()`, and only because the test tore the server down.

The cause is in how Node follows an abort signal. The SDK builds `Request` objects from our `AbortSignal`, and undici links each one to the signal through a weak reference. Once the SDK drops its last reference to a `Request`, a garbage collection can free it, and the later `abort()` reaches nobody. An experiment with a forced collection over 40 runs gave 40 hang-ups for plain `fetch` and none for the CLI's path.

## What Changes

- The CLI closes its connection to the server whenever a request ends short of the end of the stream: an idle timeout or an error chunk. It does so promptly, whatever the process did in between, a garbage collection included.
- The SDK client gets a custom fetcher that hands the abort signal of the request being made straight to `fetch`, which holds it strongly. The signal travels from the code that creates it to the fetcher through an `AsyncLocalStorage`. Requests made outside it, the lookups of the model's tools, keep the SDK's own deadline.
- A test helper collects garbage on demand, so a test can force the collection that exposes the bug.

No flag, message, exit code or output changes. A run that would have exited after a timeout now always does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ask-question`: adds the requirement that the connection is closed promptly when a request ends before the end of the stream.

## Impact

- `packages/cli/src/client.ts` (the fetcher and the signal channel), `packages/cli/src/chat.ts` (runs `chat.send` inside the channel).
- `packages/cli/test/gc.ts`, a helper that collects garbage on demand.
- Tests: a new unit test for the client, and new integration tests beside the existing hang-up test in `ask.stream.test.ts`.
- Ships as a patch release.
