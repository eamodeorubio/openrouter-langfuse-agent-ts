import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadInstructions } from '../src/oracle/instructions.js';
import { PublishedError, publishedEntry, warmUp } from '../src/published.js';
import { makeFakePnpm } from './fakePnpm.js';

const fakePnpm = makeFakePnpm();

let log: string;
beforeEach(() => {
  log = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'evals-pub-')),
    'calls.log',
  );
  vi.stubEnv('EVAL_PNPM', fakePnpm);
  vi.stubEnv('FAKE_PNPM_LOG', log);
});
afterEach(() => vi.unstubAllEnvs());

const calls = (): string[][] =>
  fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);

/** A package installed the way pnpm dlx lays it out, with its entry and its instructions in it. */
const installed = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-dlx-'));
  const pkg = path.join(root, 'node_modules/ask-openrouter/dist');
  fs.mkdirSync(pkg, { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/.bin'));
  fs.writeFileSync(path.join(pkg, 'index.js'), '');
  fs.writeFileSync(
    path.join(pkg, 'instructions.js'),
    'export const INSTRUCTIONS = "Be brief.";',
  );
  return root;
};

describe('warmUp', () => {
  it('starts the version once with --version, through pnpm dlx, and accepts the same version', async () => {
    await expect(warmUp('1.1.0')).resolves.toBeUndefined();
    expect(calls()).toEqual([['dlx', 'ask-openrouter@1.1.0', '--version']]);
  });

  it('stops with a message that names the version when pnpm fails', async () => {
    vi.stubEnv('FAKE_PNPM_FAIL', 'ERR_PNPM_NO_MATCHING_VERSION');
    await expect(warmUp('1.1.0')).rejects.toThrow(PublishedError);
    await expect(warmUp('1.1.0')).rejects.toThrow(
      new PublishedError(
        'Could not start ask-openrouter@1.1.0 through pnpm dlx: ERR_PNPM_NO_MATCHING_VERSION',
      ),
    );
  });

  it('stops with a message that names both versions when another one answers', async () => {
    vi.stubEnv('FAKE_PNPM_VERSION', '1.1.1');
    await expect(warmUp('1.1.0')).rejects.toThrow(
      'The warm-up of ask-openrouter@1.1.0 answered 1.1.1.',
    );
  });

  it('reads the last line of what pnpm printed as the version, and says when it printed nothing', async () => {
    vi.stubEnv('FAKE_PNPM_VERSION', 'Progress: resolved 1\n1.1.0');
    await expect(warmUp('1.1.0')).resolves.toBeUndefined();
    vi.stubEnv('FAKE_PNPM_VERSION', '');
    await expect(warmUp('1.1.0')).rejects.toThrow(
      new PublishedError(
        'The warm-up of ask-openrouter@1.1.0 answered nothing.',
      ),
    );
  });

  it('stops with a message that names the version when pnpm cannot start', async () => {
    vi.stubEnv('EVAL_PNPM', '/nonexistent/pnpm');
    await expect(warmUp('1.1.0')).rejects.toThrow(
      /^Could not start ask-openrouter@1\.1\.0 through pnpm dlx: spawn \/nonexistent\/pnpm ENOENT$/,
    );
  });
});

describe('the pnpm command', () => {
  it('is pnpm on the path unless EVAL_PNPM names another', async () => {
    const dir = path.dirname(makeFakePnpm());
    vi.stubEnv('EVAL_PNPM', undefined as never);
    delete process.env.EVAL_PNPM;
    vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH ?? ''}`);
    await expect(warmUp('1.1.0')).resolves.toBeUndefined();
    expect(calls()).toEqual([['dlx', 'ask-openrouter@1.1.0', '--version']]);
  });

  it('reads the last line of what pnpm printed as the path of the binary', async () => {
    const root = installed();
    vi.stubEnv(
      'FAKE_PNPM_BIN',
      `a notice\n${path.join(root, 'node_modules/.bin/ask-openrouter')}`,
    );
    expect(await publishedEntry('1.1.0')).toBe(
      path.join(root, 'node_modules/ask-openrouter/dist/index.js'),
    );
  });
});

describe('a pnpm that takes too long', () => {
  it('is killed after the time given, and the message names the version and what pnpm said', async () => {
    vi.stubEnv('FAKE_PNPM_SLEEP', '5000');
    await expect(warmUp('1.1.0', 300)).rejects.toThrow(
      new PublishedError(
        'Could not start ask-openrouter@1.1.0 through pnpm dlx: timed out after 0.3 s',
      ),
    );
    await expect(publishedEntry('1.1.0', 300)).rejects.toThrow(
      new PublishedError(
        'Could not find ask-openrouter@1.1.0 through pnpm dlx: timed out after 0.3 s',
      ),
    );
  });
});

describe('publishedEntry', () => {
  it('is the entry of the package that sits beside the .bin directory pnpm reported', async () => {
    const root = installed();
    vi.stubEnv(
      'FAKE_PNPM_BIN',
      path.join(root, 'node_modules/.bin/ask-openrouter'),
    );
    expect(await publishedEntry('1.1.0')).toBe(
      path.join(root, 'node_modules/ask-openrouter/dist/index.js'),
    );
    expect(calls()).toEqual([
      [
        'dlx',
        '--package=ask-openrouter@1.1.0',
        '-c',
        'command -v ask-openrouter',
      ],
    ]);
  });

  it('lets the instructions be read from the package that was installed', async () => {
    const root = installed();
    vi.stubEnv(
      'FAKE_PNPM_BIN',
      path.join(root, 'node_modules/.bin/ask-openrouter'),
    );
    expect(await loadInstructions(await publishedEntry('1.1.0'))).toBe(
      'Be brief.',
    );
  });

  it('fails with a message that names the file when the package has no entry where it should', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-dlx-'));
    vi.stubEnv(
      'FAKE_PNPM_BIN',
      path.join(root, 'node_modules/.bin/ask-openrouter'),
    );
    await expect(publishedEntry('1.1.0')).rejects.toThrow(
      new PublishedError(
        `pnpm dlx installed ask-openrouter@1.1.0, and ${path.join(root, 'node_modules/ask-openrouter/dist/index.js')} is not there.`,
      ),
    );
  });

  it('fails with a message that names the version when pnpm reports no binary', async () => {
    vi.stubEnv('FAKE_PNPM_BIN', '');
    await expect(publishedEntry('1.1.0')).rejects.toThrow(PublishedError);
    await expect(publishedEntry('1.1.0')).rejects.toThrow(
      'pnpm dlx installed ask-openrouter@1.1.0 but reported no ask-openrouter binary.',
    );
  });

  it('fails with a message that names the version when pnpm fails', async () => {
    vi.stubEnv('FAKE_PNPM_FAIL', 'ERR_PNPM_X');
    await expect(publishedEntry('1.1.0')).rejects.toThrow(
      new PublishedError(
        'Could not find ask-openrouter@1.1.0 through pnpm dlx: ERR_PNPM_X',
      ),
    );
  });
});
