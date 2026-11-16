import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  noPriceForUnknown,
  phantomMatch,
  recovered,
  saysNoFixedPrice,
  topOfSearch,
} from '../src/checks/assertions.js';
import { catalogModel, snapshotFile } from './oracleFixture.js';

/**
 * Answers and calls as the first full run (ask-openrouter 1.1.0) produced them,
 * cut to what a check reads. A check judged each of them wrongly. Each is paired
 * with a run built to fail the same check rightly.
 */
interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const call = (
  round: number,
  name: string,
  args: unknown,
  output: unknown,
  failed = false,
): Call => ({
  round,
  name,
  arguments: JSON.stringify(args),
  output: JSON.stringify(output),
  failed,
});

const run = (question: string, answer: string, toolCalls: Call[]) => ({
  question,
  answer,
  success: true,
  toolCalls,
});
const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = () =>
  vi.stubEnv(
    'EVAL_CATALOG',
    snapshotFile([
      catalogModel('openai/gpt-4o-mini', 128_000, true, 0.15, 0.6),
      catalogModel('openai/gpt-6.1-terra', 400_000, true, 1, 5),
    ]),
  );

describe('the 1.1.0 misfires', () => {
  it('unknown-model: prices of other models listed after "not found"', () => {
    withSnapshot();
    const unknown = meta({ unknownModel: 'openai/gpt-9' });
    const ask = 'What is the price of openai/gpt-9?';
    const lost = call(1, 'get_model', { slug: 'openai/gpt-9' }, {}, true);
    const fair = run(
      ask,
      "I couldn't find `openai/gpt-9` in the OpenRouter catalog, so I have no price for it.\n\nThe newest OpenAI models:\n- `openai/gpt-6.1-terra`: $1 / $5",
      [lost],
    );
    const wrong = run(
      ask,
      '`openai/gpt-9` costs $3 per million input tokens.',
      [lost],
    );
    expect(noPriceForUnknown(fair, unknown).pass).toBe(true);
    expect(noPriceForUnknown(wrong, unknown).pass).toBe(false);
  });

  it('typo-recovery: the typo and the correction looked up in one round', () => {
    const typo = meta({
      recovery: {
        misspelled: 'openai/gpt4o-mini',
        correction: 'openai/gpt-4o-mini',
      },
    });
    const ask = 'What does openai/gpt4o-mini cost?';
    const lookups = (miss: number, hit: number) => [
      call(miss, 'get_model', { slug: 'openai/gpt4o-mini' }, {}, true),
      call(hit, 'get_model', { slug: 'openai/gpt-4o-mini' }, { id: 'x' }),
    ];
    expect(recovered(run(ask, 'x', lookups(1, 1)), typo).pass).toBe(true);
    expect(recovered(run(ask, 'x', lookups(2, 1)), typo).pass).toBe(false);
  });

  it('router-model: "no published per-token price"', () => {
    withSnapshot();
    const ask = 'What does openai/gpt-4o-mini cost?';
    const calls = [
      call(
        1,
        'get_model',
        { slug: 'openai/gpt-4o-mini' },
        {
          id: 'openai/gpt-4o-mini',
          pricing: { prompt: null, completion: null },
        },
      ),
    ];
    const fair = run(
      ask,
      '`openai/gpt-4o-mini` has no published per-token price.',
      calls,
    );
    const wrong = run(ask, '`openai/gpt-4o-mini` is a fine model.', calls);
    expect(saysNoFixedPrice(fair, meta({})).pass).toBe(true);
    expect(saysNoFixedPrice(wrong, meta({})).pass).toBe(false);
  });

  it('single-search: a free model that ties the first at 0 and 0', () => {
    const sorted = meta({ search: { sort: 'pricing-low-to-high' } });
    const listing = call(
      1,
      'search_models',
      { sort: 'pricing-low-to-high' },
      {
        total: 3,
        models: [
          { id: 'baidu/ernie:free', prompt_price: 0, completion_price: 0 },
          { id: 'google/gemma:free', prompt_price: 0, completion_price: 0 },
          { id: 'a/paid', prompt_price: 1, completion_price: 4 },
        ],
      },
    );
    expect(
      topOfSearch(run('q', 'Use google/gemma:free.', [listing]), sorted).pass,
    ).toBe(true);
    expect(topOfSearch(run('q', 'Use a/paid.', [listing]), sorted).pass).toBe(
      false,
    );
  });

  it('none-exists: "no single model meets all three criteria"', () => {
    withSnapshot();
    const none = meta({
      oracle: { query: 'matching', params: { minContext: 9_000_000 } },
      search: { min_context_length: 9_000_000 },
    });
    const sent = [
      call(
        1,
        'search_models',
        { min_context_length: 9_000_000 },
        { total: 0, models: [] },
      ),
    ];
    expect(
      phantomMatch(
        run('q', '**No single model meets all three criteria.**', sent),
        none,
      ).pass,
    ).toBe(true);
    expect(
      phantomMatch(run('q', 'Use `a/b`, it meets them all.', sent), none).pass,
    ).toBe(false);
  });
});
