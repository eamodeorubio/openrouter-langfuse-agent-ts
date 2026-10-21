import { OpenRouter } from '@openrouter/sdk';

/**
 * The SDK client for one run. The SDK's own retry cannot express our policy
 * and runs for an hour by default, so it is switched off.
 */
export const createClient = (apiKey: string, serverURL?: string): OpenRouter =>
  new OpenRouter({
    apiKey,
    // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent because the SDK retries only for the strategy "backoff"; any other value, an empty one included, is one attempt. The explicit 'none' is for the reader.
    retryConfig: { strategy: 'none' },
    serverURL,
  });
