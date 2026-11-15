import { dispatch } from './index.js';

process.exitCode = await dispatch(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
