import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extensionHook,
  modelsOf,
  OUT_ENV,
  runHook,
  SETUP_FAILED,
  type SetupDeps,
  SetupError,
  setup,
  takeSnapshot,
} from '../src/hooks.js';
import { InstructionsError } from '../src/oracle/instructions.js';
import { type Snapshot, SnapshotError } from '../src/oracle/snapshot.js';
import { PublishedError } from '../src/published.js';
import { serveCatalog } from './catalogServer.js';

const root = path.resolve(import.meta.dirname, '..');
const stub = path.join(root, 'test/fixtures/stub-cli.mjs');

const SNAPSHOT: Snapshot = {
  fetchedAt: '2026-11-13T22:00:00.000Z',
  models: [
    {
      id: 'a/b',
      contextLength: 8000,
      supportedParameters: ['tools'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      inputPrice: 1,
      outputPrice: 4,
    },
  ],
};

const suite = { defaultTest: { vars: { model: ['a/one', 'b/two'] } } };

describe('the setup of a run', () => {
  let out: string;
  let order: string[];
  let env: NodeJS.ProcessEnv;
  const deps = (over: Partial<SetupDeps> = {}): SetupDeps => ({
    warm: async (version) => {
      order.push(`warm ${version}`);
    },
    publishedEntry: async (version) => {
      order.push(`entry ${version}`);
      return `/dlx/${version}/node_modules/ask-openrouter/dist/index.js`;
    },
    instructions: async () => {
      order.push('instructions');
      return 'Be brief.';
    },
    snapshot: async () => {
      order.push('snapshot');
      return SNAPSHOT;
    },
    exists: () => true,
    ...over,
  });

  beforeEach(() => {
    out = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'evals-setup-')),
      'a',
      'b',
    );
    order = [];
    env = { [OUT_ENV]: out };
    vi.stubEnv('EVAL_CLI', stub);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(path.dirname(path.dirname(out)), {
      recursive: true,
      force: true,
    });
  });

  it('makes the results directory, however deep, and writes the snapshot as catalog.json, passing its path on', async () => {
    await setup(suite, env, deps());
    expect(order).toEqual(['instructions', 'snapshot']);
    expect(
      JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')),
    ).toEqual(SNAPSHOT);
    expect(env.EVAL_CATALOG).toBe(path.join(out, 'catalog.json'));
  });

  it('writes the instructions of the CLI beside the results, and tells the checks where', async () => {
    const asked: string[] = [];
    await setup(
      suite,
      env,
      deps({
        instructions: async (cli) => {
          asked.push(cli);
          return 'Be brief.';
        },
      }),
    );
    expect(asked).toEqual([stub]);
    const file = path.join(out, 'instructions.txt');
    expect(fs.readFileSync(file, 'utf8')).toBe('Be brief.');
    expect(env.EVAL_INSTRUCTIONS).toBe(file);
  });

  it('runs a published version: warms it first, reads its instructions from the package, and needs no build', async () => {
    vi.stubEnv('EVAL_CLI', '/nonexistent/dist/index.js');
    env.EVAL_CLI_VERSION = '1.1.0';
    const asked: string[] = [];
    await setup(
      suite,
      env,
      deps({
        instructions: async (cli) => {
          asked.push(cli);
          order.push('instructions');
          return 'Be brief.';
        },
      }),
    );
    expect(order).toEqual([
      'warm 1.1.0',
      'entry 1.1.0',
      'instructions',
      'snapshot',
    ]);
    expect(asked).toEqual([
      '/dlx/1.1.0/node_modules/ask-openrouter/dist/index.js',
    ]);
  });

  it('writes the target beside the results: the version, or the path of the local build', async () => {
    env.EVAL_CLI_VERSION = '1.1.0';
    await setup(suite, env, deps());
    expect(fs.readFileSync(path.join(out, 'target.txt'), 'utf8')).toBe(
      'ask-openrouter@1.1.0',
    );
    env.EVAL_CLI_VERSION = '';
    await setup(suite, env, deps());
    expect(fs.readFileSync(path.join(out, 'target.txt'), 'utf8')).toMatch(
      /^local build \(.+\)$/,
    );
  });

  it('hands the models of the matrix to the checks', async () => {
    await setup(suite, env, deps());
    expect(env.EVAL_MODELS).toBe('a/one,b/two');
  });

  it.each(['latest', '^1.1.0', '1.0.9', '1.1.0; rm -rf x'])(
    'refuses the version %s before it starts anything',
    async (version) => {
      env.EVAL_CLI_VERSION = version;
      await expect(setup(suite, env, deps())).rejects.toThrow(SetupError);
      await expect(setup(suite, env, deps())).rejects.toThrow('--cli-version');
      expect(order).toEqual([]);
    },
  );

  it('stops before anything is read when the local build is not there, with the sentence of the runner', async () => {
    vi.stubEnv('EVAL_CLI', '/nonexistent/dist/index.js');
    await expect(
      setup(suite, env, deps({ exists: () => false })),
    ).rejects.toThrow(
      'The CLI is not built: /nonexistent/dist/index.js does not exist. Run `pnpm build` at the repository root, then run the evals again.',
    );
    expect(order).toEqual([]);
  });

  it('says what it needs when the results directory is not named', async () => {
    env = {};
    await expect(setup(suite, env, deps())).rejects.toThrow(SetupError);
    await expect(setup(suite, env, deps())).rejects.toThrow(
      'EVAL_OUT does not name the results directory.',
    );
    expect(order).toEqual([]);
  });

  it('stops before the instructions when the warm-up fails, or the package cannot be found', async () => {
    env.EVAL_CLI_VERSION = '1.1.0';
    await expect(
      setup(
        suite,
        env,
        deps({
          warm: async () => {
            throw new PublishedError('Could not start ask-openrouter@1.1.0');
          },
        }),
      ),
    ).rejects.toThrow(PublishedError);
    expect(order).toEqual([]);
    order = [];
    await expect(
      setup(
        suite,
        env,
        deps({
          publishedEntry: async () => {
            throw new PublishedError('reported no ask-openrouter binary');
          },
        }),
      ),
    ).rejects.toThrow('reported no ask-openrouter binary');
    // The version was warmed, and nothing after the entry was read.
    expect(order).toEqual(['warm 1.1.0']);
  });

  it('stops before the snapshot when the CLI has no instructions', async () => {
    await expect(
      setup(
        suite,
        env,
        deps({
          instructions: async () => {
            throw new InstructionsError('The CLI has no readable instructions');
          },
        }),
      ),
    ).rejects.toThrow(InstructionsError);
    expect(order).toEqual([]);
  });

  it('stops when the snapshot cannot be taken, and leaves the checks no catalog', async () => {
    await expect(
      setup(
        suite,
        env,
        deps({
          snapshot: async () => {
            throw new SnapshotError('the API answered 500');
          },
        }),
      ),
    ).rejects.toThrow(SnapshotError);
    expect(env.EVAL_CATALOG).toBeUndefined();
  });
});

describe('the snapshot of a run', () => {
  it('is taken from the catalog that EVAL_CATALOG_URL names', async () => {
    const catalog = await serveCatalog();
    const taken = await takeSnapshot({ EVAL_CATALOG_URL: catalog.url });
    await catalog.close();
    expect(taken.models.length).toBeGreaterThan(0);
  });

  it('is taken from the public catalog when none is named, which a test cannot reach', async () => {
    await expect(takeSnapshot({})).rejects.toThrow(SnapshotError);
  });
});

describe('the models of the matrix', () => {
  it('are those the suite declares, one or many', () => {
    expect(modelsOf(suite)).toEqual(['a/one', 'b/two']);
    expect(modelsOf({ defaultTest: { vars: { model: 'a/b' } } })).toEqual([
      'a/b',
    ]);
  });

  it.each([
    ['no matrix', { prompts: ['x'] }],
    ['a matrix of numbers', { defaultTest: { vars: { model: [1, 2] } } }],
    ['a matrix of nothing', { defaultTest: { vars: { model: [] } } }],
    ['no suite', undefined],
    ['a list', ['a', 'b']],
  ])(
    'are none for %s, so that promptfoo is the one to complain',
    (_, value) => {
      expect(modelsOf(value)).toEqual([]);
    },
  );
});

describe('the extension hook', () => {
  describe('when the setup fails', () => {
    let written: string;
    let hookOut: string;
    beforeEach(() => {
      hookOut = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-hook-out-'));
      vi.stubEnv(OUT_ENV, hookOut);
      vi.stubEnv('EVAL_CLI_VERSION', '');
      written = '';
      vi.spyOn(process.stderr, 'write').mockImplementation(((text: string) => {
        written += text;
        return true;
      }) as never);
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      fs.rmSync(hookOut, { recursive: true, force: true });
    });

    const base: SetupDeps = {
      warm: async () => {},
      publishedEntry: async () => '/x/index.js',
      instructions: async () => 'Be brief.',
      snapshot: async () => SNAPSHOT,
      exists: () => true,
    };
    const throws = (error: Error) => async (): Promise<never> => {
      throw error;
    };

    it.each([
      [
        'an instructions error',
        new InstructionsError('no instructions'),
        { instructions: throws(new InstructionsError('no instructions')) },
        '',
      ],
      [
        'a published error',
        new PublishedError('no package'),
        { warm: throws(new PublishedError('no package')) },
        '1.1.0',
      ],
      [
        'a snapshot error',
        new SnapshotError('no catalog'),
        { snapshot: throws(new SnapshotError('no catalog')) },
        '',
      ],
    ])(
      'writes the sentence on stderr and exits with the reserved code for %s',
      async (_, error, over, version) => {
        vi.stubEnv('EVAL_CLI_VERSION', version);
        await expect(
          runHook('beforeAll', { suite }, { ...base, ...over }),
        ).rejects.toThrow(`exit ${SETUP_FAILED}`);
        expect(written).toBe(`${error.message}\n`);
      },
    );

    it('does not hide a failure that is not an error of the setup', async () => {
      await expect(
        runHook(
          'beforeAll',
          { suite },
          { ...base, instructions: throws(new TypeError('a bug')) },
        ),
      ).rejects.toThrow('a bug');
      expect(written).toBe('');
    });

    it('sets nothing up for a hook other than beforeAll', async () => {
      const spies = {
        ...base,
        instructions: vi.fn(base.instructions),
        snapshot: vi.fn(base.snapshot),
      };
      await runHook('afterAll', { suite }, spies);
      await runHook('beforeEach', {}, spies);
      expect(spies.instructions).not.toHaveBeenCalled();
      expect(spies.snapshot).not.toHaveBeenCalled();
      expect(fs.readdirSync(hookOut)).toEqual([]);
    });

    it('writes the sentence on stderr and exits with the reserved code, for the errors of the setup', async () => {
      vi.stubEnv(OUT_ENV, '');
      await expect(extensionHook('beforeAll', { suite })).rejects.toThrow(
        `exit ${SETUP_FAILED}`,
      );
      expect(written).toBe(
        'EVAL_OUT does not name the results directory. Start the run with `pnpm eval`, which sets it.\n',
      );
    });
  });
});

describe('promptfoo run on the config directly, with the environment of the runner', () => {
  const promptfoo = path.join(root, 'node_modules/.bin/promptfoo');
  const direct = (env: Record<string, string>, out: string) =>
    new Promise<{ status: number; stderr: string }>((resolve) => {
      execFile(
        promptfoo,
        [
          'eval',
          '-c',
          path.join(root, 'promptfooconfig.yaml'),
          '--filter-metadata',
          'set=core',
          '--repeat',
          '1',
          '--no-cache',
          '-o',
          path.join(out, 'results.json'),
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PROMPTFOO_DISABLE_TELEMETRY: '1',
            PROMPTFOO_DISABLE_UPDATE: '1',
            PROMPTFOO_FAILED_TEST_EXIT_CODE: '0',
            PROMPTFOO_CONFIG_DIR: path.join(root, '.promptfoo'),
            ...env,
          },
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, _stdout, stderr) =>
          resolve({
            status: error
              ? typeof error.code === 'number'
                ? error.code
                : 1
              : 0,
            stderr,
          }),
      );
    });

  it('writes the same files beside the results as the runner does, and runs every case', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-direct-'));
    const catalog = await serveCatalog();
    const result = await direct(
      {
        EVAL_CLI: stub,
        EVAL_CATALOG_URL: catalog.url,
        EVAL_CLI_VERSION: '',
        [OUT_ENV]: out,
      },
      out,
    );
    await catalog.close();
    expect(result.status, result.stderr).toBe(0);
    for (const file of [
      'catalog.json',
      'instructions.txt',
      'target.txt',
      'results.json',
    ]) {
      expect(fs.existsSync(path.join(out, file)), file).toBe(true);
    }
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('stops before the first request, with the sentence on stderr and the code 3, when it is not told where to write', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-direct-'));
    const result = await direct({ EVAL_CLI: stub, [OUT_ENV]: '' }, out);
    expect(result.status).toBe(SETUP_FAILED);
    expect(result.stderr).toContain(
      'EVAL_OUT does not name the results directory.',
    );
    expect(fs.existsSync(path.join(out, 'results.json'))).toBe(false);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
