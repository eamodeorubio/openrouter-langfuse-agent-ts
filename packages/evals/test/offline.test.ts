import net from 'node:net';
import { describe, expect, it } from 'vitest';

describe('the offline guard', () => {
  it('refuses a socket to a host other than the loopback interface', () => {
    expect(() => net.connect({ host: 'openrouter.ai', port: 443 })).toThrow(
      /Tests never reach the network/,
    );
  });

  it('keeps the home directory of the run apart from the one of whoever runs the tests', () => {
    expect(process.env.HOME).toContain('evals-home-');
  });

  it('gives a test no real claude to run unless it brings its own stand-in', () => {
    expect(process.env.EVAL_CLAUDE).toBe(
      '/nonexistent/claude-that-no-test-may-run',
    );
  });

  it('forgets the credentials of the shell that started the run', () => {
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});
