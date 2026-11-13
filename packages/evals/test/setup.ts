import net from 'node:net';

// The unit tests of this package never reach the network. Two guards make that
// true whatever the code under test does. The live eval run is the one place
// that talks to real services, and it does not run under vitest.

// 1. The test run forgets every credential and setting of the shell that
//    started it, so that nothing can fall back on them.
for (const name of Object.keys(process.env)) {
  if (/^(OPENROUTER_|TYPESAFE_|LANGFUSE_|OTEL_|PROMPTFOO_|EVAL_)/.test(name)) {
    delete process.env[name];
  }
}

// 2. Sockets connect to the loopback interface only. HTTP, HTTPS and fetch all
//    end at a socket, so a hard-coded URL is caught too.
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
