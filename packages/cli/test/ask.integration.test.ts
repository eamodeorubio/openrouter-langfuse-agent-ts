import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { NOT_TRACED, run } from '../src/cli.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  DONE,
  errorChunk,
  RECORDED_401_MESSAGE,
  RECORDED_ANSWER,
  RECORDED_MODEL,
  RECORDED_REASONING_TOKENS,
  RECORDED_STREAM_ANSWER,
  RECORDED_STREAM_MODEL,
  RECORDED_STREAM_USAGE,
  RECORDED_USAGE,
  recordedCompletion,
  recordedStream,
  recordedUnauthorized,
  sseBody,
  sseEvent,
  streamChunk,
  thinkingChunk,
  usageChunk,
} from './fixtures.js';

// Retries wait between attempts; tests must not.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const KEY = 'sk-or-v1-marker-do-not-print';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };

interface StreamParts {
  model?: string;
  thinking?: string[];
  answer?: string[];
  usage?: Record<string, unknown> | null;
}

/** A complete streamed response. By default: answer `42`, usage 12/34/46, model `test/model`. */
const completion = ({
  model = 'test/model',
  thinking = [],
  answer = ['42'],
  usage = USAGE,
}: StreamParts = {}): string => {
  const chunks = [
    ...thinking.map(thinkingChunk),
    ...answer.map(contentChunk),
    ...(usage ? [usageChunk(usage)] : []),
  ];
  return sseBody(...chunks.map((chunk) => ({ ...chunk, model })));
};

let api: FakeApi;

interface Out {
  stdout: string;
  stderr: string;
  stdinReads: number;
}

interface Setup {
  argv?: string[];
  env?: Record<string, string>;
  stdin?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  cwd?: string;
}

// Tests must never see a developer's real .env, so the default directory is empty.
let emptyDir: string;

const goodEnv = { OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: 'env/model' };

/** Starts a run and hands back its live output, so a test can look while the stream is open. */
const start = ({
  argv = [],
  env = goodEnv,
  stdin = '',
  stdinIsTTY = false,
  stdoutIsTTY = false,
  stderrIsTTY = false,
  cwd,
}: Setup) => {
  const out: Out = { stdout: '', stderr: '', stdinReads: 0 };
  const done = run(argv, env, {
    serverURL: api.url,
    cwd: cwd ?? emptyDir,
    stdin: {
      isTTY: stdinIsTTY,
      read: async () => {
        out.stdinReads++;
        return stdin;
      },
    },
    stdout: {
      isTTY: stdoutIsTTY,
      write: (text: string) => {
        out.stdout += text;
      },
    },
    stderr: {
      isTTY: stderrIsTTY,
      write: (text: string) => {
        // The warning of an untraced run is covered in cli.trace.test.ts.
        if (text !== NOT_TRACED) {
          out.stderr += text;
        }
      },
    },
  });
  return { out, done };
};

const cli = async (setup: Setup): Promise<Out & { code: number }> => {
  const { out, done } = start(setup);
  const code = await done;
  return { code, ...out };
};

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 400 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
};

const lines = (text: string) => text.split('\n').filter((line) => line !== '');

beforeAll(async () => {
  api = await startFakeApi();
  emptyDir = await mkdtemp(join(tmpdir(), 'ask-cwd-'));
});
afterAll(async () => {
  await api.close();
  await rm(emptyDir, { recursive: true, force: true });
});
beforeEach(() => api.reset());

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

describe('unknown arguments and thinking flags', () => {
  it.each([
    ['a stray positional', ['-q', 'hi', 'extra']],
    ['an unknown option', ['-q', 'hi', '--frobnicate']],
    ['both thinking flags', ['-q', 'hi', '--thinking', '--no-thinking']],
  ])('prints usage and exits 1 on %s', async (_name, argv) => {
    api.reply(200, completion());
    const result = await cli({ argv });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
    expect(api.sent).toEqual([]);
  });

  it('lists both thinking flags in the usage message', async () => {
    const result = await cli({ argv: ['--nope'] });
    expect(result.stderr).toContain('--thinking');
    expect(result.stderr).toContain('--no-thinking');
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
        api.reply(401, { error: { code: 401, message: `rejected ${KEY}` } }),
      { argv: ['-q', 'hi'] },
    ],
    [
      '500',
      () => api.replyTimes(5, 500, `upstream echoed ${KEY}`),
      { argv: ['-q', 'hi'] },
    ],
    ['network error', () => api.networkError(), { argv: ['-q', 'hi'] }],
    [
      'error chunk',
      () =>
        api.replyTimes(5, 200, sseBody(errorChunk(500, `provider saw ${KEY}`))),
      { argv: ['-q', 'hi'] },
    ],
    ['empty stream', () => api.reply(200, sseBody()), { argv: ['-q', 'hi'] }],
    [
      'missing model',
      () => undefined,
      { argv: ['-q', 'hi'], env: { OPENROUTER_API_KEY: KEY } },
    ],
    ['bad arguments', () => undefined, { argv: ['--nope'] }],
  ])(
    'never prints the key, and replaces it where an error echoes it (%s)',
    async (_name, arrange: () => void, setup: Setup) => {
      arrange();
      const result = await cli(setup);
      expect(result.code).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain(KEY);
    },
  );

  it('marks the place where an API message echoed the key', async () => {
    api.replyTimes(5, 200, sseBody(errorChunk(500, `provider saw ${KEY}`)));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.stderr).toContain('[redacted]');
  });
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

describe('answer on stdout', () => {
  it('writes only the answer and a newline to stdout', async () => {
    api.reply(200, completion({ answer: ['4', '2'] }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('42\n');
  });

  it('writes the first text before the rest of the stream has arrived', async () => {
    const pass = api.open();
    const { out, done } = start({ argv: ['-q', 'hi'] });
    pass.write(sseEvent(contentChunk('4')));
    await until(() => out.stdout === '4');
    expect(out.stderr).toBe('');
    pass.write(sseEvent(contentChunk('2')));
    pass.write(sseEvent(usageChunk(USAGE)));
    pass.end(DONE);
    expect(await done).toBe(0);
    expect(out.stdout).toBe('42\n');
  });

  it('streams the recorded response: answer on stdout, status on stderr', async () => {
    api.reply(200, recordedStream);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${RECORDED_STREAM_ANSWER}\n`);
    expect(result.stderr).toBe(
      `model: ${RECORDED_STREAM_MODEL}\ntokens: ${RECORDED_STREAM_USAGE.promptTokens} prompt, ${RECORDED_STREAM_USAGE.completionTokens} completion (${RECORDED_STREAM_USAGE.reasoningTokens} reasoning), ${RECORDED_STREAM_USAGE.totalTokens} total\n`,
    );
  });
});

describe('a server that answers without streaming', () => {
  it('prints the complete response at once, with the status lines', async () => {
    api.reply(200, recordedCompletion);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${RECORDED_ANSWER}\n`);
    expect(result.stderr).toBe(
      `model: ${RECORDED_MODEL}\ntokens: ${RECORDED_USAGE.promptTokens} prompt, ${RECORDED_USAGE.completionTokens} completion (${RECORDED_REASONING_TOKENS} reasoning), ${RECORDED_USAGE.totalTokens} total\n`,
    );
  });

  it('shows the thinking of a complete response when asked', async () => {
    api.reply(200, recordedCompletion);
    const result = await cli({ argv: ['-q', 'hi', '--thinking'] });
    expect(result.stderr.startsWith('The user wants a single word reply')).toBe(
      true,
    );
    expect(result.stdout).toBe(`${RECORDED_ANSWER}\n`);
  });

  it('fails like a stream when the complete response holds no answer', async () => {
    api.reply(200, { ...recordedCompletion, choices: [] });
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'The model returned no answer. Try again, or choose another model.\n',
    );
  });
});

describe('status lines', () => {
  it('reports the model the stream names, not the one requested', async () => {
    api.reply(200, completion({ model: 'x/y' }));
    const result = await cli({
      argv: ['-q', 'hi', '--model', 'openrouter/auto'],
    });
    expect(result.stderr).toBe(
      'model: x/y\ntokens: 12 prompt, 34 completion, 46 total\n',
    );
  });

  it.each([
    [
      'reasoning 11',
      { ...USAGE, completion_tokens_details: { reasoning_tokens: 11 } },
      '12 prompt, 34 completion (11 reasoning), 46 total',
    ],
    [
      'reasoning 0',
      { ...USAGE, completion_tokens_details: { reasoning_tokens: 0 } },
      '12 prompt, 34 completion, 46 total',
    ],
    ['no reasoning field', USAGE, '12 prompt, 34 completion, 46 total'],
  ])('shows the reasoning count for %s', async (_name, usage, expected) => {
    api.reply(200, completion({ usage }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.stderr).toBe(`model: test/model\ntokens: ${expected}\n`);
  });
});

describe('retries', () => {
  const busy = { error: { code: 503, message: 'overloaded' } };

  it('recovers after a transient error', async () => {
    api.reply(503, busy);
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('42\n');
    expect(api.sent).toHaveLength(2);
  });

  it('retries an error chunk with a 5xx code that comes before any output', async () => {
    api.reply(200, sseBody(errorChunk(503, 'overloaded')));
    api.reply(200, completion());
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('42\n');
    expect(api.sent).toHaveLength(2);
  });

  it('gives up after the last retry, with the last error on one line', async () => {
    api.replyTimes(5, 503, busy);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'API error 503: overloaded. OpenRouter is having trouble. Try again later.\n',
    );
    expect(api.sent).toHaveLength(5);
  });

  it('does not retry a refused key', async () => {
    api.replyTimes(2, 401, recordedUnauthorized);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(api.sent).toHaveLength(1);
  });

  it('does not retry once output has started', async () => {
    const pass = api.open();
    api.reply(200, completion());
    const { out, done } = start({ argv: ['-q', 'hi'] });
    pass.write(sseEvent(contentChunk('Hel')));
    await until(() => out.stdout === 'Hel');
    pass.destroy(new Error('connection lost'));
    expect(await done).toBe(2);
    expect(out.stdout).toBe('Hel\n');
    expect(lines(out.stderr)).toHaveLength(1);
    expect(api.sent).toHaveLength(1);
  });
});

describe('API failure', () => {
  it('reports an unauthorized key with the status and the API message, exit 2', async () => {
    api.reply(401, recordedUnauthorized);
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      `API error 401: ${RECORDED_401_MESSAGE} Check OPENROUTER_API_KEY.\n`,
    );
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

describe('failure after output has started', () => {
  it('keeps the partial answer, ends its line and reports an error chunk', async () => {
    api.reply(
      200,
      sseBody(contentChunk('Hel'), errorChunk(500, 'provider failed')),
    );
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('Hel\n');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toContain('500');
    expect(result.stderr).toContain('provider failed');
    expect(api.sent).toHaveLength(1);
  });

  it('closes an open thinking line before the error line', async () => {
    api.reply(
      200,
      sseBody(thinkingChunk('hm'), errorChunk(500, 'provider failed')),
    );
    const result = await cli({
      argv: ['-q', 'hi'],
      stderrIsTTY: true,
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      `${DIM}hm${RESET}\nAPI error 500: provider failed. OpenRouter is having trouble. Try again later.\n`,
    );
  });

  it('reports a stream that is cut off, keeping what arrived', async () => {
    const pass = api.open();
    const { out, done } = start({ argv: ['-q', 'hi'] });
    pass.write(sseEvent(contentChunk('Hel')));
    await until(() => out.stdout === 'Hel');
    pass.destroy(new Error('connection lost'));
    expect(await done).toBe(2);
    expect(out.stdout).toBe('Hel\n');
    expect(out.stderr).not.toMatch(/^model:/m);
  });
});

describe('unusable response', () => {
  it('rejects a stream with no answer, exit 2', async () => {
    api.reply(200, sseBody());
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toMatch(/no answer/i);
  });

  it('rejects a stream that holds only thinking, exit 2', async () => {
    api.reply(200, completion({ thinking: ['hmm'], answer: [] }));
    const result = await cli({ argv: ['-q', 'hi', '--thinking'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/no answer/i);
  });

  it('rejects an answer with empty content only, exit 2', async () => {
    api.reply(200, completion({ answer: [''] }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('keeps the answer but exits 2 when the stream ends with no usage', async () => {
    api.reply(200, completion({ usage: null }));
    const result = await cli({ argv: ['-q', 'hi'] });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('42\n');
    expect(lines(result.stderr)).toHaveLength(1);
    expect(result.stderr).toMatch(/how many tokens/i);
  });
});

describe('thinking output', () => {
  const stream = completion({
    thinking: ['I should ', 'say hi'],
    answer: ['hi'],
  });

  it.each([
    ['shown with no flag when stderr is a terminal', [], true, true],
    ['hidden with no flag when stderr is not a terminal', [], false, false],
    ['shown by --thinking on a terminal', ['--thinking'], true, true],
    [
      'shown by --thinking when stderr is not a terminal',
      ['--thinking'],
      false,
      true,
    ],
    ['hidden by --no-thinking on a terminal', ['--no-thinking'], true, false],
    [
      'hidden by --no-thinking when stderr is not a terminal',
      ['--no-thinking'],
      false,
      false,
    ],
  ])(
    'thinking is %s',
    async (_name, flags: string[], stderrIsTTY: boolean, shown: boolean) => {
      api.reply(200, stream);
      const result = await cli({ argv: ['-q', 'hi', ...flags], stderrIsTTY });
      expect(result.code).toBe(0);
      expect(result.stderr.includes('I should say hi')).toBe(shown);
      expect(result.stdout).toBe('hi\n');
    },
  );

  it('writes the thinking to stderr and keeps stdout to the answer', async () => {
    api.reply(200, stream);
    const result = await cli({ argv: ['-q', 'hi', '--thinking'] });
    expect(result.stderr).toContain('I should say hi');
    expect(result.stdout).toBe('hi\n');
    expect(result.stdout).not.toContain('I should');
  });

  it('shows the recorded thinking, whole, in order', async () => {
    api.reply(200, recordedStream);
    const result = await cli({ argv: ['-q', 'hi', '--thinking'] });
    expect(result.stderr.startsWith('The user wants three primary')).toBe(true);
    expect(result.stdout).toBe(`${RECORDED_STREAM_ANSWER}\n`);
  });

  it('writes nothing for encrypted or summary-only reasoning', async () => {
    const encrypted = streamChunk({
      content: '',
      reasoning_details: [
        {
          type: 'reasoning.encrypted',
          data: 'ENCRYPTED-BLOB',
          format: 'unknown',
          index: 0,
        },
      ],
    });
    const summary = streamChunk({
      content: '',
      reasoning_details: [
        {
          type: 'reasoning.summary',
          summary: 'SUMMARY-TEXT',
          format: 'unknown',
          index: 0,
        },
      ],
    });
    api.reply(
      200,
      sseBody(encrypted, summary, contentChunk('hi'), usageChunk(USAGE)),
    );
    const result = await cli({
      argv: ['-q', 'hi', '--thinking'],
      stderrIsTTY: true,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      'model: test/model\ntokens: 12 prompt, 34 completion, 46 total\n',
    );
  });
});

describe('thinking style', () => {
  const thinking = completion({ thinking: ['a', 'b'], answer: ['X'] });
  const status =
    'model: test/model\ntokens: 12 prompt, 34 completion, 46 total\n';

  it('dims the thinking on a terminal and ends the line', async () => {
    api.reply(200, thinking);
    const result = await cli({ argv: ['-q', 'hi'], stderrIsTTY: true });
    expect(result.stderr).toBe(`${DIM}ab${RESET}\n${status}`);
  });

  it('adds a blank line when stdout is a terminal too', async () => {
    api.reply(200, thinking);
    const result = await cli({
      argv: ['-q', 'hi'],
      stderrIsTTY: true,
      stdoutIsTTY: true,
    });
    expect(result.stderr).toBe(`${DIM}ab${RESET}\n\n${status}`);
  });

  it.each([
    ['a non-empty NO_COLOR', '1', true],
    ['an empty NO_COLOR', '', false],
  ])(
    'treats %s as plain text: %s',
    async (_name, noColor: string, plain: boolean) => {
      api.reply(200, thinking);
      const result = await cli({
        argv: ['-q', 'hi'],
        env: { ...goodEnv, NO_COLOR: noColor },
        stderrIsTTY: true,
      });
      expect(result.stderr).toBe(
        plain ? `ab\n${status}` : `${DIM}ab${RESET}\n${status}`,
      );
    },
  );

  it('writes plain text when stderr is not a terminal', async () => {
    api.reply(200, thinking);
    const result = await cli({ argv: ['-q', 'hi', '--thinking'] });
    expect(result.stderr).toBe(`ab\n${status}`);
  });

  it('does not add a second newline when the thinking already ends its line', async () => {
    api.reply(200, completion({ thinking: ['a\n'], answer: ['X'] }));
    const result = await cli({ argv: ['-q', 'hi'], stderrIsTTY: true });
    expect(result.stderr).toBe(`${DIM}a\n${RESET}${status}`);
  });
});

describe('key redaction', () => {
  it('replaces the key in an unexpected error', async () => {
    api.reply(200, completion());
    let stderr = '';
    const broken = {
      serverURL: api.url,
      cwd: emptyDir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: {
        write: () => {
          throw new Error(`closed while holding ${KEY}`);
        },
      },
      stderr: {
        write: (text: string) => {
          if (text !== NOT_TRACED) {
            stderr += text;
          }
        },
      },
    };
    expect(await run(['-q', 'hi', '--verbose'], goodEnv, broken)).toBe(2);
    expect(stderr).toContain('detail: closed while holding [redacted]\n');
    expect(stderr).not.toContain(KEY);
  });
});

describe('a stdout that stops working mid-run', () => {
  it('still reports the failure and exits 2 when closing the line fails too', async () => {
    api.reply(
      200,
      sseBody(contentChunk('Hel'), errorChunk(500, 'provider failed')),
    );
    let writes = 0;
    let stderr = '';
    const flaky = {
      serverURL: api.url,
      cwd: emptyDir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: {
        write: () => {
          if (++writes > 1) {
            throw new Error('stdout is gone');
          }
        },
      },
      stderr: {
        write: (text: string) => {
          if (text !== NOT_TRACED) {
            stderr += text;
          }
        },
      },
    };
    expect(await run(['-q', 'hi'], goodEnv, flaky)).toBe(2);
    expect(stderr).toBe(
      'API error 500: provider failed. OpenRouter is having trouble. Try again later.\n',
    );
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
      serverURL: api.url,
      cwd: emptyDir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: {
        write: () => {
          throw thrown;
        },
      },
      stderr: {
        write: (text: string) => {
          if (text !== NOT_TRACED) {
            stderr += text;
          }
        },
      },
    };
    expect(await run(['-q', 'hi'], goodEnv, broken)).toBe(2);
    expect(stderr).toBe(
      'Something went wrong inside ask-openrouter. Try again. If it keeps happening, report it at https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues, with the output of --verbose.\n',
    );
    expect(stderr).not.toContain(expected);
  });
});
