import { AsyncLocalStorage } from 'node:async_hooks';
import { type Fetcher, HTTPClient, OpenRouter } from '@openrouter/sdk';

/** The signal of the request being made, for the fetcher to find. */
const requestSignal = new AsyncLocalStorage<AbortSignal>();

/** Runs `work` so that every SDK request it makes is aborted by `signal`. */
export const withSignal = <T>(signal: AbortSignal, work: () => T): T =>
  requestSignal.run(signal, work);

/**
 * Sends the request with `fetch`, under the signal of `withSignal` when there
 * is one. That signal replaces the one the request carries; the two are not
 * combined, which is right because a signal of ours switches the SDK's own
 * deadline off. The SDK passes a signal on through copies of the request, and
 * `fetch` follows a signal through a weak reference: once the SDK lets go of
 * the copies, a garbage collection cuts the link, and aborting the original
 * signal no longer reaches the socket. A signal given to `fetch` itself stays
 * linked for as long as the response is open.
 */
export const fetchWithSignal: Fetcher = (input, init) => {
  const signal = requestSignal.getStore();
  return signal ? fetch(input, { ...init, signal }) : fetch(input, init);
};

/**
 * The SDK client for one run. The SDK's own retry cannot express our policy
 * and runs for an hour by default, so it is switched off.
 */
export const createClient = (apiKey: string, serverURL?: string): OpenRouter =>
  new OpenRouter({
    apiKey,
    // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent because the SDK retries only for the strategy "backoff"; any other value, an empty one included, is one attempt. The explicit 'none' is for the reader.
    retryConfig: { strategy: 'none' },
    httpClient: new HTTPClient({ fetcher: fetchWithSignal }),
    serverURL,
  });
