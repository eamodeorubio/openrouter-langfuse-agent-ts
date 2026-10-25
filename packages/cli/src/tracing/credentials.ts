import type { LangfuseConfig } from '../config.js';
import { ApiError } from '../errors.js';

const CHECK_SETTINGS =
  ' Check LANGFUSE_BASE_URL and the network, or unset the three LANGFUSE_ variables to run without tracing.';

/** The longest the check may wait for Langfuse. */
export const CHECK_TIMEOUT_MS = 10_000;

/**
 * Asks Langfuse for the project of the keys, so that bad keys or a wrong URL
 * stop the run before any work is done. Fails with an `ApiError` that never
 * holds a key.
 */
export const checkCredentials = async (
  { publicKey, secretKey, baseUrl }: LangfuseConfig,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/public/projects`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
      },
      // A redirect would carry us to a host we were not told about.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.name === 'TimeoutError'
        ? `Langfuse at ${baseUrl} did not answer within ${timeoutMs / 1000} s.${CHECK_SETTINGS}`
        : `Cannot reach Langfuse at ${baseUrl}.${CHECK_SETTINGS}`,
    );
  }
  await response.body?.cancel();
  if (response.ok) {
    return;
  }
  throw new ApiError(
    response.status === 401 || response.status === 403
      ? `Langfuse rejected the keys (HTTP ${response.status}). Check LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.`
      : `Langfuse at ${baseUrl} answered HTTP ${response.status}.${CHECK_SETTINGS}`,
  );
};
