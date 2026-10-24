import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { LangfuseConfig } from '../config.js';
import { readVersion } from '../version.js';
import { checkCredentials } from './credentials.js';
import type { Tracer } from './tracer.js';

/** Test seams. The real entry point passes none. */
export interface TracingOptions {
  /** Where spans go instead of Langfuse. */
  exporter?: SpanExporter | undefined;
}

/**
 * The tracer of a traced run, once the keys are proved to work. The SDK is
 * loaded only here, after the environment has been read, so that it never
 * starts with missing credentials. `apiKey` is the OpenRouter key; it and the
 * Langfuse keys never leave the process.
 */
export const openTracer = async (
  apiKey: string,
  langfuse: LangfuseConfig,
  { exporter }: TracingOptions = {},
): Promise<Tracer> => {
  await checkCredentials(langfuse);
  const { createLangfuseTracer } = await import('./langfuse.js');
  return createLangfuseTracer({
    config: langfuse,
    exporter,
    version: await readVersion(),
    environment: langfuse.environment,
    release: langfuse.release,
    secrets: [apiKey, langfuse.publicKey, langfuse.secretKey],
  });
};
