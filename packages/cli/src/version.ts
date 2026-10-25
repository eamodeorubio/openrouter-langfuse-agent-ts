import { readFile } from 'node:fs/promises';

/** The package.json of this package, one level above both `src/` and `dist/`. */
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

/** The version this tool was released as. Fails, naming the file, when it cannot be read or holds none. */
export const readVersion = async (
  file: URL = PACKAGE_JSON,
): Promise<string> => {
  let version: unknown;
  try {
    version = (
      JSON.parse(await readFile(file, 'utf8')) as { version?: unknown }
    ).version;
  } catch {
    throw new Error('Cannot read package.json.');
  }
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('package.json holds no version.');
  }
  return version.trim();
};
