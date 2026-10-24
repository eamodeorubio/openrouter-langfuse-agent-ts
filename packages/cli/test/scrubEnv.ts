/** The variables a test run must not inherit: the keys and settings of the services the tool talks to. */
const INHERITED = /^(LANGFUSE_|OPENROUTER_|OTEL_)/;

/** Where anything that still falls back on `LANGFUSE_BASE_URL` ends up: the discard port, on which nothing listens. */
export const DEAD_BASE_URL = 'http://127.0.0.1:9';

/** Removes the inherited variables from `env`, and points `LANGFUSE_BASE_URL` at nothing. */
export const scrubEnvironment = (env: Record<string, string | undefined>) => {
  for (const name of Object.keys(env)) {
    if (INHERITED.test(name)) {
      delete env[name];
    }
  }
  env.LANGFUSE_BASE_URL = DEAD_BASE_URL;
};
