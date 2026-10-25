import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { archiveProblems, manifestProblems } from '../scripts/packCheck.js';

const manifestOf = async (): Promise<Record<string, unknown>> =>
  JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

const GOOD_FILES = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/dist/index.js',
  'package/dist/tracing/langfuse.js',
];
const SHEBANG = '#!/usr/bin/env node';

describe('the manifest of this package', () => {
  it('is ready to publish', async () => {
    expect(manifestProblems(await manifestOf())).toEqual([]);
  });
});

describe('manifestProblems', () => {
  const good = async () => structuredClone(await manifestOf());

  it.each([
    ['is private', { private: true }, /private/],
    ['has another name', { name: 'something-else' }, /name/],
    ['has no bin', { bin: undefined }, /bin/],
    [
      'has a bin that points elsewhere',
      { bin: { 'ask-openrouter': 'src/index.ts' } },
      /bin/,
    ],
    ['ships more than dist', { files: ['dist', 'src'] }, /files/],
    ['has no files list', { files: undefined }, /files/],
    ['is not public', { publishConfig: { provenance: true } }, /public/],
    [
      'has no provenance',
      { publishConfig: { access: 'public' } },
      /provenance/,
    ],
    ['has no licence', { license: undefined }, /license/],
    ['has no repository', { repository: undefined }, /repository/],
    ['has an empty repository', { repository: { type: 'git' } }, /repository/],
    ['has a blank bugs address', { bugs: '  ' }, /bugs/],
    ['has no bugs address', { bugs: undefined }, /bugs/],
    ['has no homepage', { homepage: undefined }, /homepage/],
    ['has no keywords', { keywords: [] }, /keywords/],
    ['has no engines', { engines: undefined }, /engines/],
    ['has no prepack', { scripts: {} }, /prepack/],
  ])(
    'names the problem when the manifest %s',
    async (_name, change, pattern) => {
      const manifest = { ...(await good()), ...change };
      const problems = manifestProblems(manifest);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(pattern);
    },
  );
});

describe('archiveProblems', () => {
  it('accepts the paths the spec lists', () => {
    expect(archiveProblems(GOOD_FILES, SHEBANG)).toEqual([]);
  });

  it.each([
    ['a source file', 'package/src/cli.ts'],
    ['a test', 'package/test/cli.test.ts'],
    ['a script', 'package/scripts/packCheck.ts'],
    ['an env file', 'package/.env'],
    ['a mutation report', 'package/.stryker/report.html'],
    ['a build info file', 'package/tsconfig.build.tsbuildinfo'],
    ['a stray file next to dist', 'package/dist.js'],
    ['a source map in dist', 'package/dist/index.js.map'],
    ['a build info file in dist', 'package/dist/tsconfig.build.tsbuildinfo'],
    ['a type declaration in dist', 'package/dist/index.d.ts'],
    ['an env file in dist', 'package/dist/.env'],
    ['a hidden folder in dist', 'package/dist/.stryker/report.js'],
    ['a file outside the package folder', 'other/dist/index.js'],
  ])('refuses %s', (_name, path) => {
    const problems = archiveProblems([...GOOD_FILES, path], SHEBANG);
    expect(problems.join('\n')).toContain(path);
  });

  it.each([
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
    'package/dist/index.js',
  ])('asks for %s', (path) => {
    const problems = archiveProblems(
      GOOD_FILES.filter((file) => file !== path),
      SHEBANG,
    );
    expect(problems.join('\n')).toContain(path);
  });

  it('asks for a shebang on the first line of the entry point', () => {
    expect(archiveProblems(GOOD_FILES, '// not a shebang').join('\n')).toMatch(
      /shebang/,
    );
    expect(archiveProblems(GOOD_FILES, undefined).join('\n')).toMatch(
      /shebang/,
    );
  });

  it('accepts any file under dist, and refuses anything else outside the three, for any name', () => {
    const segment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,8}$/);
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        (parts) => {
          const under = `package/dist/${parts.join('/')}.js`;
          expect(archiveProblems([...GOOD_FILES, under], SHEBANG)).toEqual([]);
          const outside = `package/${parts.join('/')}.ts`;
          expect(
            archiveProblems([...GOOD_FILES, outside], SHEBANG).join('\n'),
          ).toContain(outside);
        },
      ),
    );
  });
});

describe('the Node version this package asks for', () => {
  const require = createRequire(import.meta.url);

  /** The package.json of an installed dependency, found by walking up from its entry point. */
  const manifestOfDependency = async (name: string) => {
    let dir = dirname(require.resolve(name));
    for (;;) {
      try {
        const manifest = JSON.parse(
          await readFile(join(dir, 'package.json'), 'utf8'),
        );
        if (manifest.name === name) {
          return manifest as { engines?: { node?: string } };
        }
      } catch {
        // No package.json in this folder: look one level up.
      }
      dir = dirname(dir);
    }
  };

  /** The N of a range that reads `>=N`, or `undefined` for any other range. */
  const floorOf = (range: string | undefined) => {
    const match = /^>=\s*(\d+)(\.|$)/.exec(range ?? '');
    return match ? Number(match[1]) : undefined;
  };

  it('is the oldest the dependencies allow: no older, and not newer than needed', async () => {
    const manifest = (await manifestOf()) as {
      engines: { node: string };
      dependencies: Record<string, string>;
    };
    const floors: number[] = [];
    for (const name of Object.keys(manifest.dependencies)) {
      const floor = floorOf((await manifestOfDependency(name)).engines?.node);
      if (floor !== undefined) {
        floors.push(floor);
      }
    }
    expect(floors.length).toBeGreaterThan(0);
    expect(manifest.engines.node).toBe(`>=${Math.max(...floors)}`);
  });

  it('is the version that CI runs the tests on, besides the latest', async () => {
    const manifest = (await manifestOf()) as { engines: { node: string } };
    const minimum = floorOf(manifest.engines.node);
    const workflow = await readFile(
      new URL('../../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const job = workflow.slice(workflow.indexOf('\n  node-minimum:\n'));
    expect(job).toContain(`node-version: '${minimum}'`);
    expect(job).toContain('pnpm test');
  });
});
