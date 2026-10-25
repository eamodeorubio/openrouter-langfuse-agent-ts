import net from 'node:net';
import { expect } from 'vitest';
import { usesNock } from './nockUse.js';
import { scrubEnvironment } from './scrubEnv.js';

// Tests never reach the network: they use nock, or a server on the loopback
// interface. Two guards make that true whatever the code under test does.

// 1. The test run forgets every credential and setting of the shell that
//    started it, so that nothing can fall back on them. Whatever still falls
//    back on LANGFUSE_BASE_URL, a mutant of the tracer for one, finds a dead
//    local port.
scrubEnvironment(process.env);

// 2. A test file that does not use nock talks to servers on the loopback
//    interface only, so its sockets refuse to connect anywhere else. HTTP,
//    HTTPS and fetch all end at a socket, so a hard-coded URL is caught too.
//    A file that uses nock is left alone: nock's own sockets would trip the
//    guard, and loading nock into the other files makes their cancel and stall
//    tests fail now and then. Such a file has to call
//    `nock.disableNetConnect()`, which a test of its own checks.
if (!usesNock(expect.getState().testPath)) {
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

  /** The host a call to `Socket.connect` is about, or `undefined` for a local path or the default host. */
  const hostOf = (args: unknown[]): string | undefined => {
    // `net.connect` passes the arguments already normalized: an array whose first item is the options.
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    if (first !== null && typeof first === 'object') {
      const { host, path } = first as { host?: string; path?: string };
      return path ? undefined : host;
    }
    if (typeof first === 'number' || /^\d+$/.test(String(first))) {
      return typeof second === 'string' ? second : undefined;
    }
    return undefined;
  };

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    const host = hostOf(args);
    if (host !== undefined && !LOOPBACK.has(host)) {
      throw new Error(
        `Tests never reach the network: a test tried to connect to ${host}.`,
      );
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
