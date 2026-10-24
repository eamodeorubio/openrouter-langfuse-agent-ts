import { describe, expect, it } from 'vitest';
import { DEAD_BASE_URL, scrubEnvironment } from './scrubEnv.js';

describe('the environment of a test run', () => {
  it('loses every key and setting of the services the tool talks to, and nothing else', () => {
    const env: Record<string, string | undefined> = {
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_RELEASE: 'r',
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_MODEL: 'm',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://elsewhere.invalid',
      HOME: '/home/someone',
      PATH: '/bin',
    };
    scrubEnvironment(env);
    expect(env).toEqual({
      LANGFUSE_BASE_URL: DEAD_BASE_URL,
      HOME: '/home/someone',
      PATH: '/bin',
    });
  });

  it('points LANGFUSE_BASE_URL at the port nothing listens on, even when it was unset or set', () => {
    for (const before of [undefined, 'https://cloud.langfuse.com']) {
      const env: Record<string, string | undefined> = {
        LANGFUSE_BASE_URL: before,
      };
      scrubEnvironment(env);
      expect(env.LANGFUSE_BASE_URL).toBe('http://127.0.0.1:9');
    }
  });

  it('holds none of those variables in the running test process, whatever the shell had', () => {
    const inherited = Object.keys(process.env).filter(
      (name) =>
        /^(LANGFUSE_|OPENROUTER_|OTEL_)/.test(name) &&
        name !== 'LANGFUSE_BASE_URL',
    );
    expect(inherited).toEqual([]);
    expect(process.env.LANGFUSE_BASE_URL).toBe(DEAD_BASE_URL);
  });
});
