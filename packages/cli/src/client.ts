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

/** The parameters of a page, which the models API refuses beside a category. */
const PAGE_PARAMETERS = ['limit', 'offset'];

/** A copy of a request for the models of a category without its page, or nothing for any other request. */
const withoutRefusedPage = (request: Request): Request | undefined => {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/models') || !url.searchParams.has('category')) {
    return undefined;
  }
  for (const name of PAGE_PARAMETERS) {
    url.searchParams.delete(name);
  }
  return new Request(url, request);
};

/**
 * Sends a request to the API as the API accepts it: a list of models by
 * category takes no page, and the SDK cannot leave one out, because it adds a
 * limit and an offset to a call that gives none. The copy only follows the
 * signal of the request it replaces, through a link that a garbage collection
 * can cut once the copy is let go. So `fetch` is given that signal itself, or
 * the deadline of a lookup would not end it.
 */
export const fetchFromApi: Fetcher = (input, init) => {
  const copy = input instanceof Request ? withoutRefusedPage(input) : undefined;
  return copy
    ? fetchWithSignal(copy, { ...init, signal: (input as Request).signal })
    : fetchWithSignal(input, init);
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
    httpClient: new HTTPClient({ fetcher: fetchFromApi }),
    serverURL,
  });
