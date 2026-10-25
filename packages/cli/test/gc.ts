import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/**
 * Node hands out `gc` only under `--expose-gc`. A worker thread refuses that
 * flag, and Stryker's runner is one. V8 can switch the flag on from inside,
 * for the whole process, and a fresh context then holds the function.
 */
const gc = (() => {
  setFlagsFromString('--expose-gc');
  const found = runInNewContext('gc') as unknown;
  if (typeof found !== 'function') {
    throw new Error('V8 gave no gc function, so the test cannot collect.');
  }
  return found as () => void;
})();

/** A full garbage collection, on demand. */
export const collectGarbage = (): void => gc();
