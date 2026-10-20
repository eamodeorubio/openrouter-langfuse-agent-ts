import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { run } from '../src/cli.js';
import {
  RECORDED_401_MESSAGE,
  RECORDED_ANSWER,
  RECORDED_USAGE,
  recordedCompletion,
  recordedUnauthorized,
} from './fixtures.js';

// Retries wait between attempts; tests must not.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const PATH = '/api/v1/chat/completions';
const KEY = 'sk-or-v1-marker-do-not-print';

type Completion = Record<string, unknown>;

const completion = (overrides: Completion = {}): Completion => ({
  ...recordedCompletion,
  ...overrides,
});

interface Sent {
  model: string;
  question: string;
  authorization: string | undefined;
}

const api = {
  sent: [] as Sent[],
  reply(status: number, body: unknown) {
    let authorization: string | undefined;
    nock(HOST, {
      reqheaders: {
        authorization: (value) => {
          authorization = value ?? undefined;
          return true;
        },
      },
    })
      .post(
        PATH,
        (requestBody: { model: string; messages: { content: string }[] }) => {
          api.sent.push({
            model: requestBody.model,
            question: requestBody.messages[0]?.content ?? '',
            authorization,
          });
          return true;
        },
      )
      .reply(status, body as nock.Body);
  },
  /** Answers the next `times` requests the same way, enough to outlast the retries. */
  replyTimes(times: number, status: number, body: unknown) {
    for (let i = 0; i < times; i++) {
      api.reply(status, body);
    }
  },
  networkError() {
    nock(HOST).persist().post(PATH).replyWithError('socket hang up');
  },
};

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  stdinReads: number;
}

interface Setup {
  argv?: string[];
  env?: Record<string, string>;
  stdin?: string;
  stdinIsTTY?: boolean;
  cwd?: string;
}

// Tests must never see a developer's real .env, so the default directory is empty.
let emptyDir: string;

const goodEnv = { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'env/model' };

const cli = async ({
  argv = [],
  env = goodEnv,
  stdin = '',
  stdinIsTTY = false,
  cwd,
}: Setup): Promise<Result> => {
  let stdout = '';
  let stderr = '';
  let stdinReads = 0;
  const code = await run(argv, env, {
    cwd: cwd ?? emptyDir,
    stdin: {
      isTTY: stdinIsTTY,
      read: async () => {
        stdinReads++;
        return stdin;
      },
    },
    stdout: {
      write: (text: string) => {
        stdout += text;
      },
    },
    stderr: {
      write: (text: string) => {
        stderr += text;
      },
    },
  });
  return { code, stdout, stderr, stdinReads };
};

const lines = (text: string) => text.split('\n').filter((line) => line !== '');

beforeAll(async () => {
  nock.disableNetConnect();
  emptyDir = await mkdtemp(join(tmpdir(), 'ask-cwd-'));
});
afterAll(async () => {
  nock.enableNetConnect();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => {
  api.sent = [];
});
afterEach(() => nock.cleanAll());

describe('question source', () => {
  it('sends the -q text to the model', async () => {
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'What is a token?'] });
    expect(result.code).toBe(0);
    expect(api.sent.map((s) => s.question)).toEqual(['What is a token?']);
  });

  it('accepts a question that starts with a dash', async () => {
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', '-5 degrees in Fahrenheit'] });
    expect(result.code).toBe(0);
    expect(api.sent.map((s) => s.question)).toEqual([
      '-5 degrees in Fahrenheit',
    ]);
  });

  it('reads the question from stdin when -q is absent, trimming whitespace', async () => {
    api.reply(200, completion());
    const result = await cli({ stdin: 'What is a token?\n' });
    expect(result.code).toBe(0);
    expect(api.sent.map((s) => s.question)).toEqual(['What is a token?']);
  });

  it('prefers -q over stdin and does not read stdin', async () => {
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'A'], stdin: 'B' });
    expect(api.sent.map((s) => s.question)).toEqual(['A']);
    expect(result.stdinReads).toBe(0);
  });
});

describe('missing question', () => {
  it.each([
    ['stdin is a terminal', { stdinIsTTY: true, stdin: 'ignored' }],
    ['stdin is empty', { stdin: '' }],
    ['stdin is whitespace', { stdin: ' \n\t ' }],
    ['-q is empty', { argv: ['-q', ''] }],
    ['-q is whitespace', { argv: ['-q', '   '] }],
    ['-q has no value', { argv: ['-q'] }],
  ])('prints usage and exits 1 when %s', async (_name, setup: Setup) => {
    api.reply(200, completion());
    const result = await cli(setup);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
    expect(result.stderr).toContain('-q');
    expect(api.sent).toEqual([]);
  });

  it('does not read a terminal stdin', async () => {
    const result = await cli({ stdinIsTTY: true });
    expect(result.stdinReads).toBe(0);
  });
});

describe('unknown arguments', () => {
  it.each([
    ['a stray positional', ['-q', 'hi', 'extra']],
    ['an unknown option', ['-q', 'hi', '--verbose']],
  ])('prints usage and exits 1 on %s', async (_name, argv) => {
    api.reply(200, completion());
    const result = await cli({ argv });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
    expect(api.sent).toEqual([]);
  });
});

describe('model selection', () => {
  it.each([
    [
      '--model beats the environment',
      ['--model', 'flag/model'],
      { OPENROUTER_MODEL: 'env/model' },
      'flag/model',
    ],
    [
      'the environment is used without --model',
      [],
      { OPENROUTER_MODEL: 'env/model' },
      'env/model',
    ],
    [
      '--model works without the environment',
      ['--model', 'flag/model'],
      {},
      'flag/model',
    ],
    [
      'a blank --model falls back to the environment',
      ['--model', '  '],
      { OPENROUTER_MODEL: 'env/model' },
      'env/model',
    ],
  ])(
    '%s',
    async (_name, extra: string[], env: Record<
      string,
      string
    >, expected: string) => {
      api.reply(200, completion());
      const result = await cli({
        argv: ['-q', 'hi', ...extra],
        env: { OPENROUTER_API_KEY: KEY, ...env },
      });
      expect(result.code).toBe(0);
      expect(api.sent.map((s) => s.model)).toEqual([expected]);
    },
  );

  it.each([
    ['unset', {}],
    ['blank', { OPENROUTER_MODEL: '   ' }],
  ])(
    'exits 1 naming both sources when no model is given (%s)',
    async (_name, env: Record<string, string>) => {
      api.reply(200, completion());
      const result = await cli({
        argv: ['-q', 'hi'],
        env: { OPENROUTER_API_KEY: KEY, ...env },
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('--model');
      expect(result.stderr).toContain('OPENROUTER_MODEL');
      expect(api.sent).toEqual([]);
    },
  );
});

describe('API key', () => {
  it.each([
    ['unset', {}],
    ['blank', { OPENROUTER_API_KEY: ' ' }],
  ])(
    'exits 1 naming the variable when the key is %s',
    async (_name, key: Record<string, string>) => {
      api.reply(200, completion());
      const result = await cli({
        argv: ['-q', 'hi'],
        env: { OPENROUTER_MODEL: 'env/model', ...key },
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('OPENROUTER_API_KEY');
      expect(api.sent).toEqual([]);
    },
  );

  it('sends the key as a bearer token', async () => {
    api.reply(200, completion());
    await cli({ argv: ['-q', 'hi'] });
    expect(api.sent.map((s) => s.authorization)).toEqual([`Bearer ${KEY}`]);
  });

  it.each([
    [
      '401',
      () =>
        api.reply(401, {
          error: { code: 401, message: `rejected key ${KEY}` },
        }),
      { argv: ['-q', 'hi'] },
    ],
    [
      '500',
      () => api.replyTimes(5, 500, 'upstream exploded'),
      { argv: ['-q', 'hi'] },
    ],
    ['network error', () => api.networkError(), { argv: ['-q', 'hi'] }],
    [
      'empty choices',
      () => api.reply(200, completion({ choices: [] })),
      { argv: ['-q', 'hi'] },
    ],
    [
      'missing model',
      () => undefined,
      { argv: ['-q', 'hi'], env: { OPENROUTER_API_KEY: KEY } },
    ],
    ['bad arguments', () => undefined, { argv: ['--nope'] }],
  ])(
    'never prints the key (%s)',
    async (_name, arrange: () => void, setup: Setup) => {
      arrange();
      const result = await cli(setup);
      expect(result.code).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain(KEY);
    },
  );
});

describe('environment file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ask-env-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('takes values from .env in the current directory', async () => {
    await writeFile(
      join(dir, '.env'),
      `OPENROUTER_API_KEY=${KEY}\nOPENROUTER_MODEL=file/model\n`,
    );
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'], env: {}, cwd: dir });
    expect(result.code).toBe(0);
    expect(api.sent.map((s) => s.model)).toEqual(['file/model']);
    expect(api.sent.map((s) => s.authorization)).toEqual([`Bearer ${KEY}`]);
  });

  it('lets the environment win over .env', async () => {
    await writeFile(join(dir, '.env'), 'OPENROUTER_MODEL=file/model\n');
    api.reply(200, completion());
    await cli({
      argv: ['-q', 'hi'],
      env: { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'env/model' },
      cwd: dir,
    });
    expect(api.sent.map((s) => s.model)).toEqual(['env/model']);
  });

  it('ignores a missing .env', async () => {
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'], cwd: dir });
    expect(result.code).toBe(0);
  });
});

describe('validation order', () => {
  it('fails on a missing key without reading stdin', async () => {
    const result = await cli({
      env: { OPENROUTER_MODEL: 'env/model' },
      stdin: 'a question',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('OPENROUTER_API_KEY');
    expect(result.stdinReads).toBe(0);
  });

  it('fails on bad arguments before it looks at the environment', async () => {
    const result = await cli({ argv: ['--nope'], env: {} });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/usage/i);
    expect(result.stderr).not.toContain('is not set');
  });
});

describe('success output', () => {
  it('writes only the answer and a newline to stdout', async () => {
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${RECORDED_ANSWER}\n`);
  });

  it('writes the served model and the token usage to stderr', async () => {
    api.reply(200, completion({ model: 'x/y' }));
    const result = await cli({
      argv: ['-q', 'hi', '--model', 'openrouter/auto'],
    });
    expect(result.stderr).toBe(
      `model: x/y\ntokens: ${RECORDED_USAGE.promptTokens} prompt, ${RECORDED_USAGE.completionTokens} completion, ${RECORDED_USAGE.totalTokens} total\n`,
    );
  });
});

describe('API failure', () => {
  it('reports an unauthorized key with the status and the API message, exit 2', async () => {
    api.reply(401, recordedUnauthorized);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toBe(`API error 401: ${RECORDED_401_MESSAGE}\n`);
  });

  it('reports a server error that has a plain-text body, exit 2', async () => {
    api.replyTimes(5, 500, 'upstream exploded');
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toContain('500');
  });

  it('reports a network error on one line, exit 2', async () => {
    api.networkError();
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
  });
});

describe('key redaction', () => {
  it.each([
    [
      'an API message',
      () =>
        api.reply(401, { error: { code: 401, message: `rejected ${KEY}` } }),
      2,
    ],
    [
      'a plain-text server error',
      () => api.replyTimes(5, 500, `echo ${KEY}`),
      2,
    ],
  ])('replaces the key in %s', async (_name, arrange, code) => {
    arrange();
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(code);
    expect(result.stdout + result.stderr).not.toContain(KEY);
    expect(result.stderr).toContain('[redacted]');
  });

  it('replaces the key in an unexpected error', async () => {
    api.reply(200, completion());
    let stderr = '';
    const broken = {
      cwd: emptyDir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: {
        write: () => {
          throw new Error(`closed while holding ${KEY}`);
        },
      },
      stderr: {
        write: (text: string) => {
          stderr += text;
        },
      },
    };
    expect(await run(['-q', 'hi'], goodEnv, broken)).toBe(2);
    expect(stderr).toBe('Unexpected error: closed while holding [redacted]\n');
  });
});

describe('retries', () => {
  const busy = { error: { code: 503, message: 'overloaded' } };

  it('recovers after a transient error', async () => {
    api.reply(503, busy);
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${RECORDED_ANSWER}\n`);
    expect(api.sent).toHaveLength(2);
  });

  it('gives up after the last retry, with the last error on one line', async () => {
    api.replyTimes(5, 503, busy);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('API error 503: overloaded\n');
    expect(api.sent).toHaveLength(5);
  });

  it('does not retry a refused key', async () => {
    api.replyTimes(2, 401, recordedUnauthorized);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(api.sent).toHaveLength(1);
  });
});

describe('unusable response', () => {
  it('rejects a response with no choices, exit 2', async () => {
    api.reply(200, completion({ choices: [] }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toMatch(/no answer/i);
  });

  it('rejects an answer with null content, exit 2', async () => {
    api.reply(
      200,
      completion({
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: null },
          },
        ],
      }),
    );
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('rejects a response with no usage, exit 2', async () => {
    api.reply(200, completion({ usage: undefined }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
  });
});

describe('unexpected failure', () => {
  it.each([
    ['an Error', new Error('stdout is closed'), 'stdout is closed'],
    ['a thrown string', 'plain failure', 'plain failure'],
  ])('reports %s on stderr and exits 2', async (_name, thrown, expected) => {
    api.reply(200, completion());
    let stderr = '';
    const broken = {
      cwd: emptyDir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: {
        write: () => {
          throw thrown;
        },
      },
      stderr: {
        write: (text: string) => {
          stderr += text;
        },
      },
    };
    expect(await run(['-q', 'hi'], goodEnv, broken)).toBe(2);
    expect(stderr).toBe(`Unexpected error: ${expected}\n`);
  });
});
