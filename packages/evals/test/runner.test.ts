import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_CLI } from '../src/cliPath.js';
import {
  DEFAULT_REPEAT,
  type Deps,
  parseRunArgs,
  promptfooArgs,
  run,
} from '../src/runner.js';
import { many, resultsFile } from './resultsFixture.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');

describe('the arguments of the eval script', () => {
  const options = (argv: string[]) => {
    const parsed = parseRunArgs(
      argv,
      () => new Date('2026-11-13T21:30:00.123Z'),
    );
    if (typeof parsed === 'string') throw new Error(parsed);
    return parsed;
  };

  it('default to the config of the package, ten repeats and a results directory named by the time', () => {
    expect(options([])).toStrictEqual({
      config: path.join(root, 'promptfooconfig.yaml'),
      repeat: 10,
      out: path.join(root, 'results', '2026-11-13T21-30-00-123Z'),
    });
    expect(DEFAULT_REPEAT).toBe(10);
  });

  it('read every option, in any order, and resolve the paths', () => {
    expect(
      options([
        '--k',
        '1,3',
        '--out',
        'here',
        '--repeat',
        '4',
        '--config',
        'my.yaml',
      ]),
    ).toEqual({
      config: path.resolve('my.yaml'),
      repeat: 4,
      out: path.resolve('here'),
      k: '1,3',
    });
  });

  it('accept one repeat and refuse fewer, or a count that is not whole', () => {
    expect(options(['--repeat', '1', '--k', '1']).repeat).toBe(1);
    for (const bad of ['0', '-3', '2.5', 'x', '']) {
      expect(parseRunArgs(['--repeat', bad, '--k', '1'])).toBe(
        `--repeat takes a whole number from 1, got ${bad}.`,
      );
    }
  });

  it.each(['--config', '--repeat', '--out', '--k'])(
    'refuse %s without a value',
    (flag) => {
      expect(parseRunArgs([flag])).toBe(`Unexpected argument: ${flag}`);
    },
  );

  it('refuse an argument it does not know, even after a good one', () => {
    expect(parseRunArgs(['--repeat', '2', 'stray'])).toBe(
      'Unexpected argument: stray',
    );
    expect(parseRunArgs(['--full'])).toBe('Unexpected argument: --full');
    expect(parseRunArgs(['stray', '1,3'])).toBe('Unexpected argument: stray');
  });
});

describe('the k list against the repeats', () => {
  it('is refused before any run when the widest k is above the repeats', () => {
    expect(parseRunArgs(['--repeat', '3'])).toBe(
      '--k 1,3,5 needs at least 5 repeats and --repeat is 3. Raise --repeat, or lower --k.',
    );
    expect(parseRunArgs(['--repeat', '5', '--k', '2,7'])).toBe(
      '--k 2,7 needs at least 7 repeats and --repeat is 5. Raise --repeat, or lower --k.',
    );
  });

  it('is accepted when the widest k equals the repeats, or is below them', () => {
    expect(parseRunArgs(['--repeat', '5'])).toMatchObject({ repeat: 5 });
    expect(parseRunArgs(['--repeat', '3', '--k', '1,3'])).toMatchObject({
      repeat: 3,
      k: '1,3',
    });
    expect(parseRunArgs([])).toMatchObject({ repeat: 10 });
  });

  it.each(['1,0', 'a', '', '1.5', '1,,3'])(
    'is refused with a message when --k is %j',
    (k) => {
      expect(parseRunArgs(['--k', k])).toBe(
        `--k takes whole numbers from 1, such as 1,3,5, got ${k}.`,
      );
    },
  );
});

describe('the promptfoo command', () => {
  it('runs the config, repeats it, never reads the cache and saves JSON', () => {
    expect(
      promptfooArgs({ config: '/c/config.yaml', repeat: 7, out: '/o/dir' }),
    ).toEqual([
      'eval',
      '-c',
      '/c/config.yaml',
      '--repeat',
      '7',
      '--no-cache',
      '--no-progress-bar',
      '--no-table',
      '-o',
      path.join('/o/dir', 'results.json'),
    ]);
  });
});

describe('a run', () => {
  let out: string;
  let stdout: string;
  let stderr: string;
  let spawned: {
    command: string;
    args: string[];
    env: Record<string, string>;
    stdio: unknown;
  }[];

  const io = {
    out: (text: string) => {
      stdout += text;
    },
    err: (text: string) => {
      stderr += text;
    },
  };

  /** A promptfoo that writes the results file of `runs` runs and exits with `status`. */
  const fakePromptfoo = (status: number | null, runs = 5): Deps => ({
    spawn: (command, args, options) => {
      spawned.push({
        command,
        args,
        env: (options.env ?? {}) as Record<string, string>,
        stdio: options.stdio,
      });
      fs.writeFileSync(
        path.join(out, 'results.json'),
        JSON.stringify(resultsFile(many(runs))),
      );
      return { status };
    },
  });

  beforeEach(() => {
    out = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'evals-run-')),
      'a',
      'b',
    );
    stdout = '';
    stderr = '';
    spawned = [];
    vi.stubEnv('EVAL_CLI', stub);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(path.dirname(path.dirname(out)), {
      recursive: true,
      force: true,
    });
  });

  it('creates the results directory, runs promptfoo once with flags that keep the report whole, then reports', () => {
    fs.mkdirSync(out, { recursive: true });
    const code = run(['--repeat', '5', '--out', out], io, fakePromptfoo(0));
    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    const [call] = spawned;
    expect(call?.command).toBe(path.join(root, 'node_modules/.bin/promptfoo'));
    expect(call?.args).toEqual(
      promptfooArgs({
        config: path.join(root, 'promptfooconfig.yaml'),
        repeat: 5,
        out,
      }),
    );
    expect(call?.env).toMatchObject({
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
      PROMPTFOO_FAILED_TEST_EXIT_CODE: '0',
      PROMPTFOO_CONFIG_DIR: path.join(root, '.promptfoo'),
    });
    // promptfoo's own output goes to stderr, so that stdout holds the report alone.
    expect(call?.stdio).toEqual(['ignore', 2, 2]);
    expect(stdout).toContain('A1');
    expect(stdout).toContain('pass@5=');
    expect(stderr).toBe('');
  });

  it('makes the results directory, however deep', () => {
    const missing = path.join(out, 'deeper');
    const deps: Deps = {
      spawn: (command, args, options) => {
        expect(fs.existsSync(missing)).toBe(true);
        fs.writeFileSync(
          path.join(missing, 'results.json'),
          JSON.stringify(resultsFile(many(5))),
        );
        return fakePromptfoo(0).spawn(command, args, options);
      },
    };
    fs.mkdirSync(out, { recursive: true });
    expect(run(['--out', missing], io, deps)).toBe(0);
  });

  it('hands the --k list to the report', () => {
    fs.mkdirSync(out, { recursive: true });
    run(['--out', out, '--k', '1,2'], io, fakePromptfoo(0));
    expect(stdout).toContain('pass@2=');
    expect(stdout).not.toContain('pass@5=');
  });

  it('exits with the code of a promptfoo that stopped, and prints no report', () => {
    fs.mkdirSync(out, { recursive: true });
    expect(run(['--out', out], io, fakePromptfoo(7))).toBe(7);
    expect(stderr).toBe('promptfoo stopped with exit code 7.\n');
    expect(stdout).toBe('');
  });

  it('exits 1 when promptfoo was killed and left no code', () => {
    fs.mkdirSync(out, { recursive: true });
    expect(run(['--out', out], io, fakePromptfoo(null))).toBe(1);
    expect(stderr).toBe('promptfoo stopped with exit code 1.\n');
  });

  it('returns the exit code of a report that failed', () => {
    fs.mkdirSync(out, { recursive: true });
    expect(run(['--out', out, '--k', '9'], io, fakePromptfoo(0, 2))).toBe(1);
    expect(stderr).toMatch(/n=2.*k=9/);
  });

  it('stops with a message and the usage on a bad argument, and runs nothing', () => {
    expect(run(['--bogus'], io, fakePromptfoo(0))).toBe(2);
    expect(stderr).toBe(
      'Unexpected argument: --bogus\nUsage: run [--config <file>] [--repeat <n>] [--k 1,3,5] [--out <dir>]\n',
    );
    expect(spawned).toEqual([]);
  });

  it('stops before the first request when the CLI is not built, and makes no directory', () => {
    vi.stubEnv('EVAL_CLI', path.join(out, 'missing.js'));
    expect(run(['--out', out], io, fakePromptfoo(0))).toBe(2);
    expect(stderr).toBe(
      `The CLI is not built: ${path.join(out, 'missing.js')} does not exist. Run \`pnpm build\` at the repository root, then run the evals again.\n`,
    );
    expect(spawned).toEqual([]);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('looks for the built CLI when EVAL_CLI is not set', () => {
    vi.stubEnv('EVAL_CLI', undefined as unknown as string);
    delete process.env.EVAL_CLI;
    fs.mkdirSync(out, { recursive: true });
    const code = run(['--out', out], io, fakePromptfoo(0));
    if (fs.existsSync(BUILT_CLI)) {
      expect(spawned).toHaveLength(1);
      expect(code).toBe(0);
    } else {
      expect(code).toBe(2);
      expect(stderr).toContain(BUILT_CLI);
    }
  });

  it('starts the real promptfoo when no spawn is given, and reports what the stub CLI answered', () => {
    const code = run(['--repeat', '2', '--k', '1,2', '--out', out], io);
    expect(stderr).not.toContain('promptfoo stopped');
    expect(code).toBe(0);
    for (const model of [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'anthropic/claude-haiku-5.5',
    ]) {
      expect(stdout).toContain(model);
    }
    expect(stdout).toMatch(/A1\s+n=2/);
  });

  it('says why promptfoo did not start, and exits 1', () => {
    fs.mkdirSync(out, { recursive: true });
    const deps: Deps = {
      spawn: () => ({
        status: null,
        error: new Error('spawn promptfoo ENOENT'),
      }),
    };
    expect(run(['--out', out], io, deps)).toBe(1);
    expect(stderr).toBe('promptfoo could not start: spawn promptfoo ENOENT\n');
    expect(stdout).toBe('');
  });

  it('says which signal stopped promptfoo, and exits 1', () => {
    fs.mkdirSync(out, { recursive: true });
    const deps: Deps = { spawn: () => ({ status: null, signal: 'SIGKILL' }) };
    expect(run(['--out', out], io, deps)).toBe(1);
    expect(stderr).toBe('promptfoo was stopped by the signal SIGKILL.\n');
  });

  it('stops on a bad --k before it makes the results directory or runs promptfoo', () => {
    expect(run(['--out', out, '--repeat', '2'], io, fakePromptfoo(0))).toBe(2);
    expect(stderr).toMatch(
      /^--k 1,3,5 needs at least 5 repeats and --repeat is 2\./,
    );
    expect(spawned).toEqual([]);
    expect(fs.existsSync(out)).toBe(false);
  });
});
