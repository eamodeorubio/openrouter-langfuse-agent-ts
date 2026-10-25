import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ask } from '../src/ask.js';
import { ApiError, LimitError } from '../src/errors.js';
import type { AskEvent } from '../src/types.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import {
  contentChunk,
  recordedModel,
  sseBody,
  toolRound,
  usageChunk,
} from './fixtures.js';

// Rounds run against a real loopback server (see fakeApi.ts).
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const config = { apiKey: 'sk-test', model: 'req/model' };
const call = (id: string, slug: string) => ({
  id,
  name: 'get_model',
  arguments: JSON.stringify({ slug }),
});
const answer = (
  text: string,
  usage = { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
) => sseBody(contentChunk(text), usageChunk(usage));
const model = (id: string) => ({ data: { ...recordedModel.data, id } });

let api: FakeApi;
beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(() => api.close());
beforeEach(() => api.reset());

const events = async (question = 'q'): Promise<AskEvent[]> => {
  const all: AskEvent[] = [];
  for await (const event of ask(config, question, { serverURL: api.url })) {
    all.push(event);
  }
  return all;
};
const chats = () => api.sent.filter((sent) => sent.method === 'POST');
const gets = () => api.sent.filter((sent) => sent.method === 'GET');
const messagesOf = (n: number) => chats()[n]?.body.messages ?? [];
const toolContents = (n: number) =>
  messagesOf(n)
    .filter((message) => message.role === 'tool')
    .map((message) => String(message.content));

describe('rounds until the model answers', () => {
  it('runs the tool, sends the result back and answers from the second round', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('It costs $3.'));
    const all = await events();
    const text = all.flatMap((e) => (e.kind === 'content' ? [e.text] : []));
    expect(text.join('')).toBe('It costs $3.');
    expect(chats()).toHaveLength(2);
    expect(JSON.parse(toolContents(1)[0] ?? '')).toMatchObject({ id: 'a/b' });
  });

  it('separates the text of two rounds with a newline', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { text: 'Checking.' }));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('Done.'));
    const text = (await events()).flatMap((e) =>
      e.kind === 'content' ? [e.text] : [],
    );
    expect(text.join('')).toBe('Checking.\nDone.');
  });

  it('adds the separator once, before the first piece of the later round only', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { text: 'Checking.' }));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(
      200,
      sseBody(contentChunk('Do'), contentChunk('ne.'), usageChunk()),
    );
    const text = (await events()).flatMap((e) =>
      e.kind === 'content' ? [e.text] : [],
    );
    expect(text).toEqual(['Checking.', '\n', 'Do', 'ne.']);
  });

  it('adds no separator when the earlier text already ends the line', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { text: 'Checking.\n' }));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('Done.'));
    const text = (await events()).flatMap((e) =>
      e.kind === 'content' ? [e.text] : [],
    );
    expect(text.join('')).toBe('Checking.\nDone.');
  });

  it('ends with one done event: the last model, the tokens of every round summed', async () => {
    api.reply(
      200,
      toolRound([call('c1', 'a/b')], {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(
      200,
      answer('x', {
        prompt_tokens: 30,
        completion_tokens: 8,
        total_tokens: 38,
        completion_tokens_details: { reasoning_tokens: 3 },
      } as never),
    );
    const done = (await events()).filter((e) => e.kind === 'done');
    expect(done).toEqual([
      {
        kind: 'done',
        model: 'test/model',
        usage: {
          promptTokens: 40,
          completionTokens: 13,
          totalTokens: 53,
          reasoningTokens: 5,
        },
      },
    ]);
  });

  it('sums a missing reasoning count as absent, not as zero', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('x'));
    const done = (await events()).find((e) => e.kind === 'done');
    expect(done).toMatchObject({ usage: { reasoningTokens: undefined } });
  });

  it('sums the cost of every round, and keeps the first round cost', async () => {
    api.reply(
      200,
      toolRound([call('c1', 'a/b')], {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0.001,
        },
      }),
    );
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(
      200,
      answer('x', {
        prompt_tokens: 30,
        completion_tokens: 8,
        total_tokens: 38,
        cost: 0.002,
      } as never),
    );
    const done = (await events()).find((e) => e.kind === 'done');
    expect(done).toMatchObject({ usage: { cost: 0.003 } });
  });

  it('has no cost when a round reported none', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(
      200,
      answer('x', {
        prompt_tokens: 30,
        completion_tokens: 8,
        total_tokens: 38,
        cost: 0.002,
      } as never),
    );
    const done = (await events()).find((e) => e.kind === 'done');
    expect(done).toMatchObject({ usage: { cost: undefined } });
  });

  it('accepts a round of tool calls without any text', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('ok'));
    await expect(events()).resolves.toBeDefined();
  });

  it('fails a round of tool calls that has no token usage', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { usage: null }));
    await expect(events()).rejects.toThrow(
      new ApiError('The API response held no token usage.'),
    );
  });

  it('fails clearly on a tool call that has no id, instead of sending one the API will refuse', async () => {
    api.reply(
      200,
      toolRound([{ id: '', name: 'get_model', arguments: '{"slug":"a/b"}' }]),
    );
    await expect(events()).rejects.toThrow(
      new ApiError('The API response held a tool call without an id.'),
    );
    expect(chats()).toHaveLength(1);
    expect(gets()).toHaveLength(0);
  });

  it('fails on one call without an id among calls that have one', async () => {
    api.reply(
      200,
      toolRound([
        call('c1', 'a/b'),
        { id: '', name: 'get_model', arguments: '{"slug":"c/d"}' },
      ]),
    );
    await expect(events()).rejects.toThrow(
      new ApiError('The API response held a tool call without an id.'),
    );
    expect(gets()).toHaveLength(0);
  });

  it('fails a final round that has no answer', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, sseBody(usageChunk()));
    await expect(events()).rejects.toThrow(
      new ApiError('The API response held no answer.'),
    );
  });
});

describe('what each request holds', () => {
  it('starts with the system message and the question, and offers the tools', async () => {
    api.reply(200, answer('x'));
    await events('What is cheap?');
    const [sent] = chats();
    expect(sent?.body.messages?.[0]?.role).toBe('system');
    expect(sent?.body.messages?.[1]).toEqual({
      role: 'user',
      content: 'What is cheap?',
    });
    expect(sent?.body.tools?.map((tool) => tool.function.name)).toEqual([
      'get_model',
      'search_models',
      'calculate',
    ]);
    expect(sent?.body.parallel_tool_calls).toBe(true);
    expect(sent?.body.tool_choice).toBeUndefined();
  });

  it('offers each tool with a JSON Schema of its arguments', async () => {
    api.reply(200, answer('x'));
    await events();
    const parameters = chats()[0]?.body.tools?.[0]?.function.parameters;
    expect(parameters).toMatchObject({
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    });
  });

  it('grows by the assistant turn and the tool results, in call order', async () => {
    api.reply(200, toolRound([call('c1', 'a/one'), call('c2', 'a/two')]));
    api.replyGet('/model/a/one', 200, model('a/one'));
    api.replyGet('/model/a/two', 200, model('a/two'));
    api.reply(200, answer('x'));
    await events();
    const roles = messagesOf(1).map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(
      messagesOf(1)
        .slice(3)
        .map((m) => m.tool_call_id),
    ).toEqual(['c1', 'c2']);
    expect(messagesOf(1)[2]).toMatchObject({
      tool_calls: [
        { id: 'c1', function: { name: 'get_model' } },
        { id: 'c2', function: { name: 'get_model' } },
      ],
    });
  });

  it('keeps the text of a round in the assistant turn', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { text: 'Checking.' }));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(200, answer('x'));
    await events();
    expect(messagesOf(1)[2]).toMatchObject({ content: 'Checking.' });
  });
});

describe('parallel tool calls', () => {
  it('starts every call of a round before any of them finishes', async () => {
    api.reply(200, toolRound([call('c1', 'a/one'), call('c2', 'a/two')]));
    const releaseOne = api.holdGet('/model/a/one', 200, model('a/one'));
    const releaseTwo = api.holdGet('/model/a/two', 200, model('a/two'));
    api.reply(200, answer('x'));
    const running = events();
    for (let i = 0; i < 400 && gets().length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(gets().map((g) => g.path)).toEqual(
      expect.arrayContaining(['/api/v1/model/a/one', '/api/v1/model/a/two']),
    );
    releaseOne();
    releaseTwo();
    await running;
  });

  it('returns the results in the order of the calls, whichever finishes first', async () => {
    api.reply(200, toolRound([call('c1', 'a/slow'), call('c2', 'a/fast')]));
    const releaseSlow = api.holdGet('/model/a/slow', 200, model('a/slow'));
    api.replyGet('/model/a/fast', 200, model('a/fast'));
    api.reply(200, answer('x'));
    const running = events();
    for (let i = 0; i < 400 && gets().length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    releaseSlow();
    await running;
    expect(
      toolContents(1).map((c) => (JSON.parse(c) as { id: string }).id),
    ).toEqual(['a/slow', 'a/fast']);
  });
});

describe('tool events', () => {
  it('announces each call, in order, before any call runs', async () => {
    api.reply(200, toolRound([call('c1', 'a/one'), call('c2', 'a/two')]));
    api.holdGet('/model/a/one', 200, model('a/one'));
    api.holdGet('/model/a/two', 200, model('a/two'));
    const seen: AskEvent[] = [];
    const generator = ask(config, 'q', { serverURL: api.url });
    while (seen.filter((e) => e.kind === 'tool').length < 2) {
      const step = await generator.next();
      if (step.done) {
        break;
      }
      seen.push(step.value);
    }
    expect(seen.filter((e) => e.kind === 'tool')).toEqual([
      { kind: 'tool', name: 'get_model', arguments: '{"slug":"a/one"}' },
      { kind: 'tool', name: 'get_model', arguments: '{"slug":"a/two"}' },
    ]);
    expect(gets()).toHaveLength(0);
    await generator.return(undefined);
  });
});

describe('tool failures go to the model', () => {
  const failing = (callSpec: {
    id: string;
    name: string;
    arguments: string;
  }) => {
    api.reply(200, toolRound([callSpec]));
    api.reply(200, answer('recovered'));
  };
  const resultOf = async () => {
    const all = await events();
    expect(all.at(-1)?.kind).toBe('done');
    return String(toolContents(1)[0]);
  };

  it('reports arguments that are not JSON', async () => {
    failing({ id: 'c1', name: 'get_model', arguments: '{"slug": ' });
    expect(await resultOf()).toMatch(/not valid JSON/i);
  });

  it('reports an argument that fails validation, by name', async () => {
    failing({ id: 'c1', name: 'get_model', arguments: '{"slug":"nope"}' });
    expect(await resultOf()).toMatch(/slug/);
  });

  it('reports an unknown tool and lists the known ones', async () => {
    failing({ id: 'c1', name: 'delete_all', arguments: '{}' });
    const result = await resultOf();
    expect(result).toMatch(/delete_all/);
    expect(result).toMatch(/get_model/);
  });

  it('reports a model the API does not know', async () => {
    failing(call('c1', 'a/gone'));
    api.replyGet('/model/a/gone', 404, {
      error: { message: 'Model not found: a/gone', code: 404 },
    });
    expect(await resultOf()).toMatch(/Model not found: a\/gone/);
  });

  it('reports an API failure of the tool with its status, after the retries', async () => {
    failing(call('c1', 'a/down'));
    for (let i = 0; i < 5; i++) {
      api.replyGet('/model/a/down', 503, {
        error: { message: 'busy', code: 503 },
      });
    }
    expect(await resultOf()).toMatch(/503/);
    expect(gets()).toHaveLength(5);
  });

  it('gives up on a lookup that takes longer than the idle limit and tells the model it timed out', async () => {
    failing(call('c1', 'a/stuck'));
    api.holdGet('/model/a/stuck', 200, model('a/stuck'));
    const all: AskEvent[] = [];
    for await (const event of ask(config, 'q', {
      serverURL: api.url,
      toolTimeoutMs: 300,
    })) {
      all.push(event);
    }
    expect(all.at(-1)?.kind).toBe('done');
    expect(String(toolContents(1)[0])).toMatch(/timed out/i);
  });

  it('applies the tool timeout to a search as well', async () => {
    failing({
      id: 'c1',
      name: 'search_models',
      arguments: '{"query":"stuck"}',
    });
    api.holdGet('/models', 200, {
      data: [],
      total_count: 0,
      links: { next: null },
    });
    for await (const _ of ask(config, 'q', {
      serverURL: api.url,
      toolTimeoutMs: 300,
    })) {
      // drained
    }
    expect(String(toolContents(1)[0])).toMatch(/timed out/i);
  });

  it('does not cut a slow lookup short because the idle limit is short', async () => {
    failing(call('c1', 'a/slow'));
    const release = api.holdGet('/model/a/slow', 200, model('a/slow'));
    setTimeout(release, 400);
    const all: AskEvent[] = [];
    for await (const event of ask(config, 'q', {
      serverURL: api.url,
      idleTimeoutMs: 150,
    })) {
      all.push(event);
    }
    expect(String(toolContents(1)[0])).toMatch(/"id":"a\/slow"/);
  });

  it('shows each failure as a JSON object with an error field', async () => {
    failing({ id: 'c1', name: 'get_model', arguments: '{' });
    const parsed = JSON.parse(await resultOf()) as { error: string };
    expect(typeof parsed.error).toBe('string');
  });
});

describe('round limit', () => {
  const endless = () => {
    for (let i = 0; i < 9; i++) {
      api.reply(200, toolRound([call(`c${i}`, 'a/b')]));
    }
    for (let i = 0; i < 8; i++) {
      api.replyGet('/model/a/b', 200, model('a/b'));
    }
  };

  it('forbids tools in the request after the eighth tool round, then gives up', async () => {
    endless();
    await expect(events()).rejects.toBeInstanceOf(LimitError);
    expect(chats()).toHaveLength(9);
    expect(chats().map((sent) => sent.body.tool_choice)).toEqual([
      ...Array(8).fill(undefined),
      'none',
    ]);
    expect(gets()).toHaveLength(8);
  });

  it('says in one line that the model kept calling tools', async () => {
    endless();
    await expect(events()).rejects.toThrow(/kept calling tools/i);
  });

  it('lets the model answer on the ninth request when it stops calling tools', async () => {
    for (let i = 0; i < 8; i++) {
      api.reply(200, toolRound([call(`c${i}`, 'a/b')]));
      api.replyGet('/model/a/b', 200, model('a/b'));
    }
    api.reply(200, answer('Enough.'));
    const all = await events();
    expect(all.at(-1)?.kind).toBe('done');
    expect(chats()).toHaveLength(9);
  });
});

describe('retry applies to each request', () => {
  it('retries a later round that fails before it produced text, and writes the earlier text once', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')], { text: 'Checking.' }));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(503, { error: { code: 503, message: 'busy' } });
    api.reply(200, answer('Done.'));
    const text = (await events()).flatMap((e) =>
      e.kind === 'content' ? [e.text] : [],
    );
    expect(chats()).toHaveLength(3);
    expect(text.join('')).toBe('Checking.\nDone.');
  });

  it('does not retry a later round that fails after it produced text', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 200, model('a/b'));
    api.reply(
      200,
      `${sseBody(contentChunk('Hel')).replace('data: [DONE]\n\n', '')}data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"error":{"code":500,"message":"boom"}}\n\n`,
    );
    await expect(events()).rejects.toThrow(/500/);
    expect(chats()).toHaveLength(2);
  });
});

describe('the key stays out of what the model reads and the screen shows', () => {
  const KEY = 'sk-or-v1-marker-do-not-print';

  const withKey = async (): Promise<AskEvent[]> => {
    const all: AskEvent[] = [];
    for await (const event of ask({ ...config, apiKey: KEY }, 'q', {
      serverURL: api.url,
    })) {
      all.push(event);
    }
    return all;
  };

  it('replaces the key in a tool result, whatever the API echoed', async () => {
    api.reply(200, toolRound([call('c1', 'a/b')]));
    api.replyGet('/model/a/b', 401, {
      error: { message: `Bad key ${KEY} for a/b`, code: 401 },
    });
    api.reply(200, answer('x'));
    await withKey();
    const result = toolContents(1)[0] ?? '';
    expect(result).not.toContain(KEY);
    expect(result).toContain('[redacted]');
  });

  it('replaces the key in the failure of a search, too', async () => {
    api.reply(
      200,
      toolRound([
        { id: 'c1', name: 'search_models', arguments: '{"query":"x"}' },
      ]),
    );
    api.replyGet('/models', 401, {
      error: { message: `Bad key ${KEY}`, code: 401 },
    });
    api.reply(200, answer('x'));
    await withKey();
    const result = toolContents(1)[0] ?? '';
    expect(result).not.toContain(KEY);
    expect(result).toContain('[redacted]');
  });

  it('replaces the key in the arguments of a tool event', async () => {
    api.reply(
      200,
      toolRound([
        { id: 'c1', name: 'get_model', arguments: `{"slug":"${KEY}/x"}` },
      ]),
    );
    api.reply(200, answer('x'));
    const tool = (await withKey()).find((e) => e.kind === 'tool');
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool)).not.toContain(KEY);
    expect(JSON.stringify(tool)).toContain('[redacted]');
  });
});
