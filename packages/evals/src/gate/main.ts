import { gate } from './cli.js';

process.exitCode = gate(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
