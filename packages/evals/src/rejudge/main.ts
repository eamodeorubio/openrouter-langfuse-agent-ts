import { rejudge } from './rejudge.js';

process.exitCode = rejudge(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
