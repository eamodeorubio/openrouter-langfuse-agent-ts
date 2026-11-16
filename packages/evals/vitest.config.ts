import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
    // The integration tests start promptfoo as a child process, which takes seconds.
    testTimeout: 60_000,
    // The same child processes start in the `beforeAll` of several suites, and a loaded machine needs longer than the default 10 s.
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
