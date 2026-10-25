import { readFile } from 'node:fs/promises';
import { COMMAND } from './help.js';

/** The package.json of this package, one level above both `src/` and `dist/`. */
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

const UNKNOWN_VERSION = `Cannot tell which version of ${COMMAND} this is. Reinstall it.`;

/** The version this tool was released as. Fails, saying so, when the file cannot be read or holds none. */
export const readVersion = async (
  file: URL = PACKAGE_JSON,
): Promise<string> => {
  const version = await readFile(file)
    .then(
      (bytes) =>
        (JSON.parse(bytes.toString()) as { version?: unknown }).version,
    )
    .catch(() => undefined);
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(UNKNOWN_VERSION);
  }
  return version.trim();
};
