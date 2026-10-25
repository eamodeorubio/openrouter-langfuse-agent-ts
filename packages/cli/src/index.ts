#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { run } from './cli.js';

const interrupt = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => interrupt.abort(signal));
}

process.exitCode = await run(process.argv.slice(2), process.env, {
  signal: interrupt.signal,
  cwd: process.cwd(),
  stdin: {
    isTTY: Boolean(process.stdin.isTTY),
    read: () => text(process.stdin),
  },
  stdout: process.stdout,
  stderr: process.stderr,
});

// An interrupted run leaves a stream open that would keep the process alive.
if (interrupt.signal.aborted) {
  process.exit();
}
