import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVersion } from '../src/version.js';

describe('readVersion', () => {
  it('is the version in the package.json of this package', async () => {
    const { version } = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(await readVersion()).toBe(version);
  });

  describe('with another file', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'version-'));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    const at = (name: string) => pathToFileURL(join(dir, name));

    it('reads the version field', async () => {
      await writeFile(join(dir, 'p.json'), '{"name":"x","version":"9.8.7"}');
      expect(await readVersion(at('p.json'))).toBe('9.8.7');
    });

    it('trims the version', async () => {
      await writeFile(join(dir, 'p.json'), '{"version":" 9.8.7 "}');
      expect(await readVersion(at('p.json'))).toBe('9.8.7');
    });

    it.each([
      ['has no version', '{"name":"x"}'],
      ['has a version that is not text', '{"version":5}'],
      ['has a blank version', '{"version":"  "}'],
    ])('says it holds no version when it %s', async (_n, body) => {
      await writeFile(join(dir, 'p.json'), body);
      await expect(readVersion(at('p.json'))).rejects.toThrow(
        'package.json holds no version.',
      );
    });

    it('says it cannot read the file when it is not JSON', async () => {
      await writeFile(join(dir, 'p.json'), 'nope');
      await expect(readVersion(at('p.json'))).rejects.toThrow(
        'Cannot read package.json.',
      );
    });

    it('says it cannot read the file when it is missing', async () => {
      await expect(readVersion(at('missing.json'))).rejects.toThrow(
        'Cannot read package.json.',
      );
    });
  });
});
