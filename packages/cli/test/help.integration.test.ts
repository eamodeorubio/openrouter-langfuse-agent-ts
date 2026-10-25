import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { helpText } from '../src/help.js';
import { readVersion } from '../src/version.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import { sink } from './sink.js';

let api: FakeApi;
let dir: string;
let version: string;

beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-help-'));
  version = await readVersion();
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

interface Setup {
  env?: Record<string, string>;
  stdin?: string;
  isTTY?: boolean;
  manifest?: URL;
}

const cli = async (argv: string[], setup: Setup = {}) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(argv, setup.env ?? {}, {
    serverURL: api.url,
    cwd: dir,
    manifest: setup.manifest,
    stdin: { isTTY: setup.isTTY ?? false, read: async () => setup.stdin ?? '' },
    stdout: sink(out, 'stdout'),
    stderr: sink(out, 'stderr'),
  });
  return { code, ...out };
};

const helpOf = () => helpText(version);

describe('--help', () => {
  it.each([['--help'], ['-h']])(
    'prints the help to stdout on %s',
    async (flag) => {
      const result = await cli([flag]);
      expect(result).toEqual({ code: 0, stdout: helpOf(), stderr: '' });
      expect(api.sent).toEqual([]);
    },
  );

  it('opens with the name and the version', async () => {
    const { stdout } = await cli(['--help']);
    expect(stdout.split('\n')[0]).toBe(`ask-openrouter ${version}`);
  });

  it.each([
    ['other arguments and --json', ['-q', 'hi', '--json', '--help']],
    ['an unknown flag', ['--bogus', '--help']],
    ['a contradiction', ['--thinking', '--no-thinking', '-h']],
  ])('wins over %s, as plain text', async (_name, argv) => {
    const result = await cli(argv);
    expect(result).toEqual({ code: 0, stdout: helpOf(), stderr: '' });
  });

  it('needs no key, no model and no .env', async () => {
    const result = await cli(['--help'], { env: {} });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(helpOf());
  });

  it('prints the same text whatever the environment holds', async () => {
    const bare = await cli(['--help']);
    const set = await cli(['--help'], {
      env: {
        OPENROUTER_API_KEY: 'sk-test',
        OPENROUTER_MODEL: 'm',
        NO_COLOR: '1',
      },
    });
    expect(set.stdout).toBe(bare.stdout);
    expect(set.stdout).not.toContain('sk-test');
  });

  it('still prints, with the name alone, when the manifest cannot be read', async () => {
    const manifest = pathToFileURL(join(dir, 'missing.json'));
    const result = await cli(['--help'], { manifest });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(helpText(undefined));
    expect(result.stdout.split('\n')[0]).toBe('ask-openrouter');
  });
});

describe('--version', () => {
  it.each([['--version'], ['-v']])(
    'prints the bare version on %s',
    async (flag) => {
      const result = await cli([flag]);
      expect(result).toEqual({ code: 0, stdout: `${version}\n`, stderr: '' });
      expect(api.sent).toEqual([]);
    },
  );

  it.each([
    ['other arguments and --json', ['-q', 'hi', '--json', '--version']],
    ['an unknown flag', ['--bogus', '--version']],
  ])('wins over %s, as plain text', async (_name, argv) => {
    const result = await cli(argv);
    expect(result).toEqual({ code: 0, stdout: `${version}\n`, stderr: '' });
  });

  it.each([
    ['--version', '--help'],
    ['--help', '--version'],
    ['-v', '-h'],
  ])('gives way to help in %s %s', async (...argv) => {
    const result = await cli(argv);
    expect(result).toEqual({ code: 0, stdout: helpOf(), stderr: '' });
    expect(result.stdout.split('\n')[0]).toContain(version);
  });

  it('fails with one line on stderr when the manifest cannot be read', async () => {
    const manifest = pathToFileURL(join(dir, 'missing.json'));
    const result = await cli(['--version'], { manifest });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd()).not.toContain('\n');
    expect(result.stderr).toContain('package.json');
  });
});

describe('--version with a manifest that holds no version', () => {
  it('says so, in the words of the reader', async () => {
    const file = join(dir, 'empty.json');
    await writeFile(file, '{"name":"x"}');
    const result = await cli(['--version'], { manifest: pathToFileURL(file) });
    expect(result).toEqual({
      code: 2,
      stdout: '',
      stderr: 'package.json holds no version.\n',
    });
  });
});

describe('the help after a usage error', () => {
  it.each([
    ['an unknown flag', ['-q', 'hi', '--bogus'], undefined],
    ['a stray positional', ['-q', 'hi', 'extra'], undefined],
    ['a missing value', ['-q'], undefined],
    [
      'both thinking flags',
      ['-q', 'hi', '--thinking', '--no-thinking'],
      undefined,
    ],
    ['a missing question', [], ''],
  ])('ends stderr with the help on %s', async (_name, argv, stdin) => {
    const result = await cli(argv, {
      env: { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' },
      stdin,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.endsWith(`\n\n${helpOf()}`)).toBe(true);
    expect(result.stderr.split('\n\n')[0]).not.toBe('');
    expect(api.sent).toEqual([]);
  });

  it('names the flag it did not recognise', async () => {
    const result = await cli(['--bogus']);
    expect(result.stderr.split('\n\n')[0]).toContain('--bogus');
  });

  it('keeps the JSON object alone under --json', async () => {
    const result = await cli(['--json', '--bogus']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'USAGE_ERROR' },
    });
    expect(result.stderr).not.toContain('Usage');
  });
});
