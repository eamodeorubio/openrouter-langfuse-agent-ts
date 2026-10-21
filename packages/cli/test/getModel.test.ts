import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { getModel } from '../src/tools/getModel.js';
import { recordedModel } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const client = createClient('sk-test-key');
const run = (args: { slug: string }) =>
  getModel.run(args, { client, timeoutMs: 60_000 });

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('get_model arguments', () => {
  it.each([
    ['openai/gpt-5', true],
    ['openai/gpt-5:free', true],
    ['meta-llama/llama-3.3-70b-instruct', true],
    ['gpt-5', false],
    ['/gpt-5', false],
    ['openai/', false],
    ['a/b/c', false],
    ['', false],
    ['open ai/gpt-5', false],
    ['../models', false],
    ['./x', false],
    ['a/..', false],
    ['a/.', false],
    ['...//x', false],
    ['.hidden/x.y', true],
    ['a/b..c', true],
  ])('slug %j is valid: %s', (slug, valid) => {
    expect(getModel.parameters.safeParse({ slug }).success).toBe(valid);
  });

  it.each([[{}], [{ slug: 5 }], [{ slug: 'a/b', extra: 1 }], [null], ['a/b']])(
    'rejects the arguments %j',
    (args) => {
      expect(getModel.parameters.safeParse(args).success).toBe(false);
    },
  );
});

describe('get_model', () => {
  it('requests the model by author and slug, variant included', async () => {
    const scope = nock(HOST)
      // The SDK encodes the colon of a variant; the live API decodes it (checked).
      .get('/api/v1/model/openai/gpt-5%3Afree')
      .reply(200, recordedModel);
    const result = await run({ slug: 'openai/gpt-5:free' });
    expect(result.ok).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('sends the key as a bearer token', async () => {
    const scope = nock(HOST, {
      reqheaders: { authorization: 'Bearer sk-test-key' },
    })
      .get('/api/v1/model/openai/gpt-oss-20b')
      .reply(200, recordedModel);
    await run({ slug: 'openai/gpt-oss-20b' });
    expect(scope.isDone()).toBe(true);
  });

  it('returns the fields a model needs to judge cost, flattened and in dollars per million tokens', async () => {
    nock(HOST)
      .get('/api/v1/model/openai/gpt-oss-20b')
      .reply(200, recordedModel);
    const result = await run({ slug: 'openai/gpt-oss-20b' });
    if (!result.ok) {
      throw new Error(result.message);
    }
    const value = JSON.parse(JSON.stringify(result.value));
    const source = recordedModel.data as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      [
        'id',
        'name',
        'expiration_date',
        'description',
        'created',
        'knowledge_cutoff',
        'context_length',
        'max_completion_tokens',
        'input_modalities',
        'output_modalities',
        'tokenizer',
        'supported_parameters',
        'pricing',
        'reasoning',
        'benchmarks',
      ].sort(),
    );
    expect(value).toMatchObject({
      id: 'openai/gpt-oss-20b',
      name: 'OpenAI: gpt-oss-20b',
      description: source.description,
      created: '2025-08-05',
      knowledge_cutoff: '2024-06-30',
      context_length: 131072,
      max_completion_tokens: 32768,
      input_modalities: ['text'],
      output_modalities: ['text'],
      tokenizer: 'GPT',
      supported_parameters: source.supported_parameters,
      pricing: { prompt: 0.018, completion: 0.09, input_cache_read: 0.009 },
      reasoning: {
        mandatory: true,
        supported_efforts: ['high', 'medium', 'low'],
        default_effort: 'medium',
      },
    });
    expect(value.benchmarks.artificial_analysis).toEqual({
      intelligence_index: 10,
      coding_index: null,
      agentic_index: null,
    });
  });

  it('keeps token prices and overrides and drops the prices that are not per token', async () => {
    const model = {
      data: {
        ...(recordedModel.data as object),
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
          input_cache_read: '0.0000003',
          request: '0.01',
          image: '0.004',
          web_search: '0.01',
          overrides: [
            {
              min_prompt_tokens: 200000,
              prompt: '0.000006',
              completion: '0.0000225',
            },
          ],
        },
      },
    };
    nock(HOST).get('/api/v1/model/a/b').reply(200, model);
    const result = await run({ slug: 'a/b' });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(
      JSON.parse(
        JSON.stringify((result.value as { pricing: unknown }).pricing),
      ),
    ).toEqual({
      prompt: 3,
      completion: 15,
      input_cache_read: 0.3,
      overrides: [{ min_prompt_tokens: 200000, prompt: 6, completion: 22.5 }],
    });
  });

  it('gives null for the price of a router that has none', async () => {
    const model = {
      data: {
        ...(recordedModel.data as object),
        pricing: { prompt: '-1', completion: '-1' },
      },
    };
    nock(HOST).get('/api/v1/model/openrouter/auto').reply(200, model);
    const result = await run({ slug: 'openrouter/auto' });
    expect(result).toMatchObject({
      ok: true,
      value: { pricing: { prompt: null, completion: null } },
    });
  });

  it('drops every override field that is neither a token price nor a condition', async () => {
    const model = {
      data: {
        ...(recordedModel.data as object),
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
          overrides: [
            {
              min_prompt_tokens: 200000,
              utc_days: ['monday'],
              utc_start: 9,
              utc_end: 17,
              prompt: '0.000006',
              audio: '0.000001',
              input_audio_cache: '0.000002',
            },
          ],
        },
      },
    };
    nock(HOST).get('/api/v1/model/a/b').reply(200, model);
    const result = await run({ slug: 'a/b' });
    if (!result.ok) {
      throw new Error(result.message);
    }
    const { pricing } = JSON.parse(JSON.stringify(result.value));
    expect(pricing.overrides).toEqual([
      {
        min_prompt_tokens: 200000,
        utc_days: ['monday'],
        utc_start: 9,
        utc_end: 17,
        prompt: 6,
      },
    ]);
  });

  it('omits what the API omits', async () => {
    const {
      description: _d,
      reasoning: _r,
      benchmarks: _b,
      ...rest
    } = recordedModel.data as Record<string, unknown>;
    nock(HOST).get('/api/v1/model/a/b').reply(200, { data: rest });
    const result = await run({ slug: 'a/b' });
    if (!result.ok) {
      throw new Error(result.message);
    }
    const value = JSON.parse(JSON.stringify(result.value));
    expect(value).not.toHaveProperty('description');
    expect(value).not.toHaveProperty('reasoning');
    expect(value).not.toHaveProperty('benchmarks');
  });

  it('lets an unexpected failure through, because it is a bug and not a result', async () => {
    const broken = {
      models: {
        get: async () => {
          throw new RangeError('bug');
        },
      },
    } as never;
    await expect(
      getModel.run({ slug: 'a/b' }, { client: broken, timeoutMs: 60_000 }),
    ).rejects.toThrow(new RangeError('bug'));
  });

  it('reports an unknown model to the model, not as a crash', async () => {
    nock(HOST)
      .get('/api/v1/model/openai/nope')
      .reply(404, {
        error: { message: 'Model not found: openai/nope', code: 404 },
      });
    expect(await run({ slug: 'openai/nope' })).toEqual({
      ok: false,
      message: 'Model not found: openai/nope',
    });
  });

  it('reports another API failure with its status, after the retries', async () => {
    const scope = nock(HOST)
      .get('/api/v1/model/a/b')
      .times(5)
      .reply(503, { error: { message: 'busy', code: 503 } });
    const result = await run({ slug: 'a/b' });
    expect(scope.isDone()).toBe(true);
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toMatch(
      /^API error 503: .*busy/,
    );
  });

  it('recovers from a transient failure', async () => {
    nock(HOST)
      .get('/api/v1/model/a/b')
      .reply(503, { error: { message: 'busy', code: 503 } })
      .get('/api/v1/model/a/b')
      .reply(200, recordedModel);
    expect((await run({ slug: 'a/b' })).ok).toBe(true);
  });

  it('does not retry a refused key', async () => {
    const scope = nock(HOST)
      .get('/api/v1/model/a/b')
      .once()
      .reply(401, { error: { message: 'No auth', code: 401 } });
    const result = await run({ slug: 'a/b' });
    expect(scope.isDone()).toBe(true);
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toMatch(
      /^API error 401: .*No auth/,
    );
  });
});
