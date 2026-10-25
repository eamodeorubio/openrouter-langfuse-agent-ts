import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NOT_TRACED, run } from '../src/cli.js';
import { helpText } from '../src/help.js';
import { readVersion } from '../src/version.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import { contentChunk, sseBody, usageChunk } from './fixtures.js';
import { sink } from './sink.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const KEY = 'sk-or-v1-marker-do-not-print';
const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
const ISSUES =
  'https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues';
const GOOD = { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'm' };

let api: FakeApi;
let dir: string;
let help: string;

beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-errors-'));
  help = helpText(await readVersion());
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

interface Setup {
  env?: Record<string, string>;
  stdin?: string;
  isTTY?: boolean;
  cwd?: string;
  read?: () => Promise<string>;
  idleTimeoutMs?: number;
}

const cli = async (argv: string[], setup: Setup = {}) => {
  const out = { stdout: '', stderr: '' };
  const code = await run(argv, setup.env ?? GOOD, {
    serverURL: api.url,
    idleTimeoutMs: setup.idleTimeoutMs,
    cwd: setup.cwd ?? dir,
    stdin: {
      isTTY: setup.isTTY ?? false,
      read: setup.read ?? (async () => setup.stdin ?? ''),
    },
    stdout: sink(out, 'stdout'),
    stderr: {
      write: (text: string) => {
        if (text !== NOT_TRACED) {
          out.stderr += text;
        }
      },
    },
  });
  return { code, ...out };
};

/** Each line the tool wrote to stderr. */
const lines = (stderr: string) =>
  stderr.split('\n').filter((line) => line !== '');

describe('usage errors', () => {
  it.each([
    [
      '-q without a value',
      ['-q'],
      '-q needs a value, the question. Example: -q "What is a token?". Or leave -q out and pipe the question in.',
    ],
    [
      '--model without a value',
      ['-q', 'hi', '--model'],
      '--model needs a value, a model slug. Example: --model openai/gpt-4o-mini',
    ],
    [
      '--model followed by a flag',
      ['-q', 'hi', '--model', '--verbose'],
      '--model needs a value, a model slug. Example: --model openai/gpt-4o-mini',
    ],
    [
      'an unknown option',
      ['-q', 'hi', '--bogus'],
      "Unknown option '--bogus'. The options this tool accepts are listed below.",
    ],
    [
      'an unknown short option',
      ['-z'],
      "Unknown option '-z'. The options this tool accepts are listed below.",
    ],
    [
      'a positional argument',
      ['-q', 'hi', 'extra'],
      "Unexpected argument 'extra'. Quote the question and pass it with -q, or pipe it in.",
    ],
    [
      'a switch given a value',
      ['-q', 'hi', '--verbose=1'],
      '--verbose takes no value. Write --verbose alone.',
    ],
    [
      'both thinking flags',
      ['-q', 'hi', '--thinking', '--no-thinking'],
      'Use either --thinking or --no-thinking, not both. Remove one.',
    ],
    [
      'a blank -q',
      ['-q', '   '],
      'The question given with -q is empty. Write the question after -q, or leave -q out and pipe the question in.',
    ],
  ])(
    'says what to do about %s, then prints the help',
    async (_name, argv, message) => {
      const result = await cli(argv);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(`${message}\n\n${help}`);
      expect(api.sent).toEqual([]);
    },
  );

  it('asks for a question when stdin is a terminal', async () => {
    const result = await cli([], { isTTY: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `No question given. Pass it with -q "your question", or pipe it in.\n\n${help}`,
    );
  });

  it('asks for a question when stdin is empty', async () => {
    const result = await cli([], { stdin: '' });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `No question given. Standard input is empty. Pass -q "your question", or pipe the question in.\n\n${help}`,
    );
  });

  it('never quotes the parser', async () => {
    for (const argv of [
      ['-q'],
      ['--model'],
      ['--bogus'],
      ['x'],
      ['--json=1'],
    ]) {
      const { stderr } = await cli(argv);
      expect(stderr).not.toMatch(
        /Option '|To specify|argument missing|ambiguous/,
      );
    }
  });
});

describe('configuration errors', () => {
  const MODEL =
    'No model given. Set OPENROUTER_MODEL in the environment or in a .env file in the current directory, or pass --model <model>. A model is a slug such as openai/gpt-4o-mini; models are listed at https://openrouter.ai/models.';
  const API_KEY =
    'OPENROUTER_API_KEY is not set. Set it in the environment or in a .env file in the current directory. Get a key at https://openrouter.ai/keys.';

  it('says all three ways to give a model', async () => {
    const result = await cli(['-q', 'hi'], {
      env: { OPENROUTER_API_KEY: KEY },
    });
    expect(result).toEqual({ code: 1, stdout: '', stderr: `${MODEL}\n` });
    expect(api.sent).toEqual([]);
  });

  it('says where to set the key', async () => {
    const result = await cli(['-q', 'hi'], {
      env: { OPENROUTER_MODEL: 'm' },
    });
    expect(result).toEqual({ code: 1, stdout: '', stderr: `${API_KEY}\n` });
  });

  it('gives the same words as error.message under --json', async () => {
    const result = await cli(['-q', 'hi', '--json'], {
      env: { OPENROUTER_API_KEY: KEY },
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'CONFIG_ERROR', message: MODEL },
    });
  });

  it('explains an unreadable .env without the system code', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'cli-env-'));
    try {
      await mkdir(join(bad, '.env'));
      const result = await cli(['-q', 'hi'], { cwd: bad });
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        'Cannot read .env in the current directory: it is a directory. Fix its permissions, or remove it and set the variables in the environment.\n',
      );
      expect(result.stderr).not.toMatch(/EISDIR|EACCES/);
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });
});

describe('service errors', () => {
  it.each([
    [401, 'No auth credentials found', 'Check OPENROUTER_API_KEY.'],
    [403, 'Forbidden', 'Check OPENROUTER_API_KEY.'],
    [
      402,
      'Insufficient credits',
      'Add credits at https://openrouter.ai/settings/credits.',
    ],
    [
      404,
      'No such model',
      'If the model is unknown, check the slug passed with --model or set in OPENROUTER_MODEL.',
    ],
  ])('adds the remedy for %i', async (status, text, remedy) => {
    api.reply(status, { error: { message: text, code: status } });
    const result = await cli(['-q', 'hi']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    const [line, ...rest] = lines(result.stderr);
    expect(rest).toEqual([]);
    expect(line).toContain(String(status));
    expect(line).toContain(text);
    expect(line?.endsWith(` ${remedy}`)).toBe(true);
    expect(result.stderr).not.toContain(KEY);
  });

  it.each([
    [429, ' Wait a moment and try again.'],
    [500, ' OpenRouter is having trouble. Try again later.'],
    [503, ' OpenRouter is having trouble. Try again later.'],
  ])(
    'adds the remedy for %i once the retries are spent',
    async (status, remedy) => {
      api.replyTimes(5, status, { error: { message: 'busy', code: status } });
      const result = await cli(['-q', 'hi']);
      expect(result.code).toBe(2);
      expect(lines(result.stderr)).toHaveLength(1);
      expect(result.stderr.trimEnd().endsWith(remedy)).toBe(true);
    },
  );

  it('shows the status and its reason for a reply that is a web page', async () => {
    api.replyTimes(
      5,
      502,
      '<html><body><h1>502 Bad Gateway</h1></body></html>',
    );
    const result = await cli(['-q', 'hi']);
    expect(result.code).toBe(2);
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toContain('502');
    expect(result.stderr).not.toMatch(/[<>]/);
  });

  it('adds the remedy for a silent stream', async () => {
    api.open();
    const result = await cli(['-q', 'hi'], { idleTimeoutMs: 200 });
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(result.code).toBe(2);
    expect(lines(result.stderr)).toEqual([
      'Request timed out: no data for 0.2 s. Try again, or choose another model.',
    ]);
  });

  it('says it cannot reach OpenRouter, without the library text', async () => {
    api.networkError();
    const result = await cli(['-q', 'hi']);
    expect(result.code).toBe(2);
    expect(lines(result.stderr)).toEqual([
      'Cannot reach OpenRouter. Check your network connection and try again.',
    ]);
  });

  it('says the model returned no answer', async () => {
    api.reply(200, sseBody(usageChunk(USAGE)));
    const result = await cli(['-q', 'hi']);
    expect(result.code).toBe(2);
    expect(lines(result.stderr)).toEqual([
      'The model returned no answer. Try again, or choose another model.',
    ]);
  });

  it('says the reply did not report the tokens', async () => {
    api.reply(200, sseBody(contentChunk('42')));
    const result = await cli(['-q', 'hi']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('42\n');
    expect(lines(result.stderr)).toEqual([
      "OpenRouter's reply did not report how many tokens it used. Try again, or choose another model.",
    ]);
  });
});

describe('Langfuse errors', () => {
  const REMEDY =
    ' Check LANGFUSE_BASE_URL and the network, or unset the three LANGFUSE_ variables to run without tracing.';
  const langfuse = (baseUrl: string) => ({
    ...GOOD,
    LANGFUSE_PUBLIC_KEY: 'pk-lf-marker',
    LANGFUSE_SECRET_KEY: 'sk-lf-marker',
    LANGFUSE_BASE_URL: baseUrl,
  });

  it('adds the remedy when Langfuse cannot be reached', async () => {
    const result = await cli(['-q', 'hi'], {
      env: langfuse('http://127.0.0.1:1'),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      `Cannot reach Langfuse at http://127.0.0.1:1.${REMEDY}\n`,
    );
  });

  it('adds the remedy when Langfuse answers with another status', async () => {
    const origin = api.url.replace(/\/api\/v1$/, '');
    api.replyGet('/api/public/projects', 500, {});
    const result = await cli(['-q', 'hi'], { env: langfuse(origin) });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      `Langfuse at ${origin} answered HTTP 500.${REMEDY}\n`,
    );
  });
});

describe('--verbose on an error that explains itself', () => {
  it('adds no detail line to a configuration error', async () => {
    const result = await cli(['-q', 'hi', '--verbose'], {
      env: { OPENROUTER_API_KEY: KEY },
    });
    expect(result.code).toBe(1);
    expect(result.stderr.endsWith('models.\n')).toBe(true);
    expect(result.stderr).not.toContain('detail:');
  });
});

describe('an unexpected failure', () => {
  const MESSAGE = `Something went wrong inside ask-openrouter. Try again. If it keeps happening, report it at ${ISSUES}, with the output of --verbose.`;
  const broken = (thrown: unknown) => ({
    read: async () => {
      throw thrown;
    },
  });

  it.each([
    ['a TypeError', new TypeError('Cannot read properties of undefined')],
    ['a string', 'plain failure'],
    ['an object', { toString: 0 }],
  ])('hides what %s says', async (_name, thrown) => {
    const result = await cli([], broken(thrown));
    expect(result).toEqual({ code: 2, stdout: '', stderr: `${MESSAGE}\n` });
  });

  it('adds the detail on a line of its own with --verbose', async () => {
    const result = await cli(['--verbose'], broken(new TypeError('boom')));
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(`${MESSAGE}\ndetail: boom\n`);
  });

  it('masks the key in the detail', async () => {
    const result = await cli(
      ['--verbose'],
      broken(new Error(`closed while holding ${KEY}`)),
    );
    expect(result.stderr).toContain('detail: closed while holding [redacted]');
    expect(result.stderr).not.toContain(KEY);
  });

  it('keeps the detail out of the JSON object', async () => {
    const result = await cli(
      ['--json', '--verbose'],
      broken(new TypeError('boom')),
    );
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      success: false,
      error: { code: 'UNEXPECTED_ERROR', message: MESSAGE },
    });
    expect(result.stderr).not.toContain('boom');
    expect(result.stderr).not.toContain('detail');
  });
});
