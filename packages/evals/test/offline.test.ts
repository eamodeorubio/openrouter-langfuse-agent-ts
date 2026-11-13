import net from 'node:net';
import { describe, expect, it } from 'vitest';

describe('the offline guard', () => {
  it('refuses a socket to a host other than the loopback interface', () => {
    expect(() => net.connect({ host: 'openrouter.ai', port: 443 })).toThrow(
      /Tests never reach the network/,
    );
  });

  it('forgets the credentials of the shell that started the run', () => {
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});
