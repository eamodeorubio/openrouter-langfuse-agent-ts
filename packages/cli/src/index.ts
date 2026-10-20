import { text } from 'node:stream/consumers';
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), process.env, {
  cwd: process.cwd(),
  stdin: {
    isTTY: Boolean(process.stdin.isTTY),
    read: () => text(process.stdin),
  },
  stdout: process.stdout,
  stderr: process.stderr,
});
