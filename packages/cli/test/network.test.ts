import { readdirSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { disablesNetConnect, usesNock } from './nockUse.js';

/** Addresses and names reserved so that nothing ever answers them, even if a guard failed. */
const PUBLIC = { host: '192.0.2.1', port: 80 };

describe('the network of a test run', () => {
  it.each([
    ['an address on the public network', PUBLIC],
    ['a name on the public network', { host: 'example.invalid', port: 443 }],
  ])('refuses a socket to %s', (_name, target) => {
    let socket: net.Socket | undefined;
    try {
      expect(() => {
        socket = net.connect(target);
      }).toThrow(/never reach the network/);
    } finally {
      socket?.destroy();
    }
  });

  it.each([
    ['http', http],
    ['https', https],
  ])('refuses an %s request to a public host', (_name, client) => {
    expect(() => client.get({ ...PUBLIC })).toThrow(/never reach the network/);
  });

  it('refuses fetch to a public URL', async () => {
    let failure: unknown;
    try {
      await fetch('http://192.0.2.1/', { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      failure = (error as Error & { cause?: unknown }).cause ?? error;
    }
    expect(String((failure as Error | undefined)?.message)).toMatch(
      /never reach the network/,
    );
  });

  it('still lets a test talk to a server on 127.0.0.1 and on localhost', async () => {
    const server = http.createServer((_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      for (const host of ['127.0.0.1', 'localhost']) {
        expect(await (await fetch(`http://${host}:${port}/`)).text()).toBe(
          'ok',
        );
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('leaves no test file that uses nock without turning net connect off', () => {
    const offenders = readdirSync(__dirname, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => `${__dirname}/${name}`)
      .filter((file) => usesNock(file) && !disablesNetConnect(file));
    expect(offenders).toEqual([]);
  });
});
