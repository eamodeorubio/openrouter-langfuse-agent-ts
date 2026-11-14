import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JudgeProvider, {
  JUDGE_MODEL,
  STATE_LIMIT_BYTES,
} from '../src/judge/provider.js';
import { serveJev } from './jevServer.js';

let jev: Awaited<ReturnType<typeof serveJev>>;

beforeEach(async () => {
  jev = await serveJev({ noul: 0.42 });
  vi.stubEnv('OPENROUTER_API_KEY', 'dummy-key-123');
  vi.stubEnv('EVAL_JUDGE_URL', jev.url);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await jev.close();
});

const rubric = 'Does the answer address the question that was asked?';
const grade = (state: string, config: Record<string, unknown> = {}) =>
  new JudgeProvider({ config: { threshold: 0.5, ...config } }).callApi(
    'ignored',
    {
      prompt: { label: 'llm-rubric', raw: 'x' },
      vars: { rubric, output: state },
      bustCache: true,
    } as never,
  );

describe('the judge provider', () => {
  it('asks Jev one Noul question about the state, with the key in the header', async () => {
    const result = await grade('Question: q\n\nAnswer: a');
    expect(result.error).toBeUndefined();
    expect(jev.requests).toHaveLength(1);
    const [request] = jev.requests;
    expect(request?.url).toBe('/v1/systemone');
    expect(request?.authorization).toBe('Bearer dummy-key-123');
    expect(request?.body.model).toBe(JUDGE_MODEL);
    expect(JUDGE_MODEL).toBe('typesafe/jev-1.14');
    expect(request?.body.state).toBe('Question: q\n\nAnswer: a');
    expect(request?.body.questions).toEqual({
      grade: { type: 'noul', instructions: rubric },
    });
  });

  it('records the score of Jev, and fails the rubric under the threshold', async () => {
    const result = await grade('state');
    expect(result.output).toMatchObject({ pass: false, score: 0.42 });
    expect(String((result.output as { reason: string }).reason)).toMatch(
      /^Jev Noul probability 0\.42 < threshold 0\.5/,
    );
  });

  it('passes the rubric at the threshold or above it', async () => {
    await jev.close();
    jev = await serveJev({ noul: 0.5 });
    vi.stubEnv('EVAL_JUDGE_URL', jev.url);
    expect((await grade('state')).output).toMatchObject({
      pass: true,
      score: 0.5,
    });
    expect((await grade('state', { threshold: 0.9 })).output).toMatchObject({
      pass: false,
    });
  });

  it('grades a state of exactly 32,000 bytes, and none of 32,001 bytes, which sends no request', async () => {
    expect(STATE_LIMIT_BYTES).toBe(32_000);
    expect((await grade('x'.repeat(32_000))).error).toBeUndefined();
    expect(jev.requests).toHaveLength(1);
    const over = await grade('x'.repeat(32_001));
    expect(over.output).toBeUndefined();
    expect(over.error).toBe(
      'The state is too large: 32001 bytes, over the limit of 32000. Above it Jev answers in a slower, less accurate mode, so the rubric was not graded.',
    );
    expect(jev.requests).toHaveLength(1);
  });

  it('counts the size of the state in bytes, not in characters', async () => {
    const wide = '€'.repeat(10_667);
    expect((await grade(wide)).error).toMatch(
      /^The state is too large: 32001 bytes/,
    );
    expect(jev.requests).toHaveLength(0);
  });

  it('sends no request and says so when the key is not set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const result = await grade('state');
    expect(result.error).toBe(
      'OPENROUTER_API_KEY is not set, so the rubric was not graded.',
    );
    expect(jev.requests).toHaveLength(0);
  });

  it('answers with an error, and never a score, when the API fails', async () => {
    await jev.close();
    jev = await serveJev({ status: 500 });
    vi.stubEnv('EVAL_JUDGE_URL', jev.url);
    const result = await grade('state');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/^TypeSafe API error: 500/);
  });

  it('answers with an error when the response is no answer', async () => {
    await jev.close();
    jev = await serveJev({ body: '{"answers":{}}' });
    vi.stubEnv('EVAL_JUDGE_URL', jev.url);
    const result = await grade('state');
    expect(result.output).toBeUndefined();
    expect(result.error).toMatch(/unexpected response/);
  });

  it('accepts the thresholds 0 and 1', () => {
    expect(() => new JudgeProvider({ config: { threshold: 0 } })).not.toThrow();
    expect(() => new JudgeProvider({ config: { threshold: 1 } })).not.toThrow();
  });

  it('says that there is no state to grade, and asks Jev nothing, when the rubric holds none', async () => {
    const provider = new JudgeProvider({ config: { threshold: 0.5 } });
    const message = 'The rubric has no state to grade, so it was not graded.';
    for (const context of [
      undefined,
      {},
      { vars: {} },
      { vars: { output: { answer: 'x' } } },
      { vars: { output: 3 } },
    ]) {
      expect((await provider.callApi('p', context as never)).error).toBe(
        message,
      );
    }
    expect(jev.requests).toHaveLength(0);
  });

  it('is named, and needs a threshold from 0 to 1 in its config', () => {
    expect(new JudgeProvider({ config: { threshold: 0.5 } }).id()).toBe(
      'ask-openrouter-judge',
    );
    for (const threshold of [undefined, -0.1, 1.1, '0.5', Number.NaN]) {
      expect(
        () => new JudgeProvider({ config: { threshold } as never }),
      ).toThrow(
        `The judge needs a threshold from 0 to 1 in its config, got ${JSON.stringify(threshold)}.`,
      );
    }
    expect(() => new JudgeProvider()).toThrow(/needs a threshold/);
  });
});
