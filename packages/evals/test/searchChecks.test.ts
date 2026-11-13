import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countStated,
  phantomMatch,
  searchArguments,
  singleSearch,
  topOfSearch,
} from '../src/checks/assertions.js';
import { snapshotFile } from './oracleFixture.js';

interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const search = (
  args: Record<string, unknown> | string,
  ids: string[] = [],
  extra: Record<string, unknown> = {},
  failed = false,
): Call => ({
  round: 1,
  name: 'search_models',
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
  output: JSON.stringify({
    total: ids.length,
    models: ids.map((id) => ({ id })),
    ...extra,
  }),
  failed,
});

const getModel = (id: string): Call => ({
  round: 1,
  name: 'get_model',
  arguments: JSON.stringify({ slug: id }),
  output: JSON.stringify({ id }),
  failed: false,
});

const success = (answer: string, toolCalls: Call[] = []) => ({
  question: 'q',
  answer,
  success: true,
  toolCalls,
});

const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = () => vi.stubEnv('EVAL_CATALOG', snapshotFile());

const WIDE = { min_context_length: 250000, supported_parameters: ['tools'] };
const required = { search: WIDE };

describe('searchArguments, for wrong-search', () => {
  it('passes a run with a search that sent every required filter', () => {
    const run = success('x', [search(WIDE)]);
    expect(searchArguments(run, meta(required)).pass).toBe(true);
    expect(searchArguments(run, meta(required)).reason).toBe(
      'A search_models call carried every required filter.',
    );
  });

  it('fails a run whose searches dropped a filter, and says which', () => {
    const run = success('x', [search({ supported_parameters: ['tools'] })]);
    const result = searchArguments(run, meta(required));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'No search_models call carries every constraint: min_context_length of at least 250000, supported_parameters with tools.',
    );
  });

  it('fails a run that made no search at all, because the case asks for one', () => {
    expect(
      searchArguments(success('x', [getModel('a/b')]), meta(required)).pass,
    ).toBe(false);
  });

  it('is satisfied by one search among several, and ignores a search that failed', () => {
    const calls = [search({}), search(WIDE)];
    expect(searchArguments(success('x', calls), meta(required)).pass).toBe(
      true,
    );
    const failedOnly = [search(WIDE, [], {}, true), getModel('a/b')];
    expect(searchArguments(success('x', failedOnly), meta(required)).pass).toBe(
      false,
    );
    // With no call that worked, the run belongs to memory-answer.
    expect(
      searchArguments(
        success('x', [search(WIDE, [], {}, true)]),
        meta(required),
      ).reason,
    ).toBe('Left to an earlier class.');
  });

  it('requires a text value to match exactly', () => {
    const sorted = meta({ search: { sort: 'pricing-low-to-high' } });
    expect(
      searchArguments(
        success('x', [search({ sort: 'pricing-low-to-high' })]),
        sorted,
      ).pass,
    ).toBe(true);
    expect(
      searchArguments(success('x', [search({ sort: 'newest' })]), sorted).pass,
    ).toBe(false);
  });

  it('passes a case that requires no search, and leaves a run with no lookup or answer to earlier classes', () => {
    expect(
      searchArguments(success('x', [getModel('a/b')]), meta({})).reason,
    ).toBe('No search required.');
    expect(searchArguments(success('x'), meta(required)).reason).toBe(
      'Left to an earlier class.',
    );
    expect(
      searchArguments(success('', [search(WIDE)]), meta(required)).reason,
    ).toBe('Left to an earlier class.');
  });
});

describe('phantomMatch', () => {
  const none = meta({
    oracle: { query: 'matching', params: { minContext: 9_000_000 } },
    search: { min_context_length: 9_000_000 },
  });
  const sent = [search({ min_context_length: 9_000_000 })];

  it.each([
    'No model meets all three requirements.',
    'There are no models with that much context.',
    'None exists on OpenRouter.',
    'Such a model does not exist.',
    "That model doesn't exist.",
    'There is no such model.',
    'I found no match.',
    'I could not find one.',
    'Nothing fits.',
  ])('passes an answer that says none exists: %s', (answer) => {
    withSnapshot();
    const result = phantomMatch(success(answer, sent), none);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The answer says that no model matches.');
  });

  it('fails an answer that recommends a model', () => {
    withSnapshot();
    const result = phantomMatch(
      success('Use t/a, it has everything you asked for.', sent),
      none,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The snapshot holds no matching model, and the answer does not say so.',
    );
  });

  it('does not take a word that merely holds a phrase for the phrase', () => {
    withSnapshot();
    for (const answer of [
      'Nonetheless, use t/a.',
      'Anyone can use t/a, it is nothingness-free.',
      'Notice t/a.',
    ]) {
      expect(phantomMatch(success(answer, sent), none).pass, answer).toBe(
        false,
      );
    }
  });

  it('reads the phrases in any case', () => {
    withSnapshot();
    expect(phantomMatch(success('NO SUCH MODEL.', sent), none).pass).toBe(true);
  });

  it('does not apply when the snapshot holds a matching model, which is a change of the catalog and not a fault of the run', () => {
    withSnapshot();
    const possible = meta({
      oracle: { query: 'matching', params: { minContext: 1000 } },
    });
    const result = phantomMatch(success('Use t/a.', [search({})]), possible);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The snapshot holds a model that meets the request, so the case does not apply.',
    );
  });

  it('leaves a run whose search dropped a filter to wrong-search', () => {
    withSnapshot();
    const result = phantomMatch(success('Use t/a.', [search({})]), none);
    expect(result.reason).toBe('Left to wrong-search.');
  });

  it('passes a case with no oracle, and leaves a run with no lookup or answer to earlier classes', () => {
    withSnapshot();
    expect(phantomMatch(success('x', sent), meta({})).reason).toBe(
      'No oracle query.',
    );
    expect(phantomMatch(success('x'), none).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('singleSearch, for wasteful-search', () => {
  it('passes one search that sent a sort', () => {
    const result = singleSearch(
      success('x', [search({ sort: 'pricing-low-to-high' })]),
      meta({}),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('One search with a sort answered the question.');
  });

  it('fails more than one search, and says how many', () => {
    const calls = [
      search({ sort: 'a' }),
      search({ sort: 'a', offset: 10 }),
      search({ sort: 'a', offset: 20 }),
    ];
    const result = singleSearch(success('x', calls), meta({}));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The run made 3 searches, and one answers the question.',
    );
  });

  it('fails a search with no sort, an empty sort or one that is not text, and a run with no search', () => {
    for (const args of [{}, { sort: '' }, { sort: 3 }, 'not json']) {
      const result = singleSearch(success('x', [search(args)]), meta({}));
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('No search_models call sent a sort.');
    }
    expect(singleSearch(success('x', [getModel('a/b')]), meta({})).pass).toBe(
      false,
    );
  });

  it('ignores a search that failed', () => {
    const calls = [search({}, [], {}, true), search({ sort: 'a' })];
    expect(singleSearch(success('x', calls), meta({})).pass).toBe(true);
  });

  it('leaves a run with no lookup or answer to earlier classes', () => {
    expect(singleSearch(success('x'), meta({})).reason).toBe(
      'Left to an earlier class.',
    );
    expect(
      singleSearch(success('', [search({ sort: 'a' })]), meta({})).reason,
    ).toBe('Left to an earlier class.');
  });
});

describe('topOfSearch, for wrong-answer', () => {
  const sorted = meta({ search: { sort: 'pricing-low-to-high' } });
  const first = (ids: string[]) => [
    search({ sort: 'pricing-low-to-high' }, ids),
  ];

  it('passes an answer that names the model the search listed first', () => {
    const result = topOfSearch(
      success('Use a/cheap.', first(['a/cheap', 'b/dear'])),
      sorted,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer names the model the search listed first.',
    );
  });

  it('fails an answer that names another, and says which model came first', () => {
    const result = topOfSearch(
      success('Use b/dear.', first(['a/cheap', 'b/dear'])),
      sorted,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer does not name the model the search listed first: a/cheap.',
    );
  });

  it('matches a whole name, in any case', () => {
    expect(
      topOfSearch(success('Use A/CHEAP!', first(['a/cheap'])), sorted).pass,
    ).toBe(true);
    expect(
      topOfSearch(success('Use a/cheaper.', first(['a/cheap'])), sorted).pass,
    ).toBe(false);
  });

  it('reads the first search that worked, and its first model', () => {
    const calls = [
      search({ sort: 'pricing-low-to-high' }, ['a/x'], {}, true),
      ...first(['b/y', 'a/x']),
    ];
    expect(topOfSearch(success('b/y', calls), sorted).pass).toBe(true);
  });

  it('passes when the search listed no model', () => {
    const result = topOfSearch(success('None.', first([])), sorted);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The search listed no model.');
  });

  it('leaves a run whose search dropped a required filter to wrong-search', () => {
    const result = topOfSearch(success('b/y', [search({}, ['a/x'])]), sorted);
    expect(result.reason).toBe('Left to wrong-search.');
  });

  it('leaves a run with no lookup or answer to earlier classes', () => {
    expect(topOfSearch(success('x'), sorted).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('countStated, for wrong-value', () => {
  const counting = meta({
    oracle: {
      query: 'matching',
      params: { minContext: 250000, supportedParameters: ['tools'] },
    },
    search: WIDE,
  });
  // On the table of the oracle spec, t/a, t/d, t/f and t/h have that context and tools.

  it('passes an answer with the number of models the query returns on the snapshot', () => {
    withSnapshot();
    const result = countStated(
      success('There are 4 such models.', [search(WIDE, [], { total: 7 })]),
      counting,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer states a count the snapshot or the search supports: 4, 7.',
    );
  });

  it('passes an answer with the total the search reported, which may differ from the snapshot', () => {
    withSnapshot();
    expect(
      countStated(
        success('I count 7 of them.', [search(WIDE, [], { total: 7 })]),
        counting,
      ).pass,
    ).toBe(true);
  });

  it('fails an answer that states the first page, and says which counts it would have taken', () => {
    withSnapshot();
    const result = countStated(
      success('There are 10 such models.', [search(WIDE, [], { total: 7 })]),
      counting,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('The answer states none of the counts: 4, 7.');
  });

  it('takes the total only of a search that carried the filters', () => {
    withSnapshot();
    const calls = [
      search({}, [], { total: 99 }),
      search(WIDE, [], { total: 7 }),
    ];
    expect(countStated(success('99 models', calls), counting).pass).toBe(false);
    expect(countStated(success('7 models', calls), counting).pass).toBe(true);
  });

  it('ignores a total that is not a number, and a search that failed', () => {
    withSnapshot();
    const calls = [
      search(WIDE, [], { total: 'many' }),
      search(WIDE, [], { total: 8 }, true),
      search(WIDE, [], { total: 7 }),
    ];
    expect(countStated(success('There are 8.', calls), counting).pass).toBe(
      false,
    );
  });

  it('leaves a run whose search dropped a filter to wrong-search', () => {
    withSnapshot();
    expect(countStated(success('4', [search({})]), counting).reason).toBe(
      'Left to wrong-search.',
    );
  });

  it('passes a case with no oracle, and leaves a run with no lookup or answer to earlier classes', () => {
    withSnapshot();
    expect(countStated(success('4', [search(WIDE)]), meta({})).reason).toBe(
      'No oracle query.',
    );
    expect(countStated(success('4'), counting).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('the search checks, for any output and any case', () => {
  it('never throw but for a case that cannot be read, and return a verdict', () => {
    withSnapshot();
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [
          searchArguments,
          phantomMatch,
          singleSearch,
          topOfSearch,
          countStated,
        ]) {
          try {
            const result = check(output, context as never);
            expect(typeof result.pass).toBe('boolean');
            expect(result.score).toBe(result.pass ? 1 : 0);
            expect(result.reason).not.toBe('');
          } catch (error) {
            expect(String(error)).toMatch(
              /case|oracle|query|snapshot|EVAL_CATALOG/i,
            );
          }
        }
      }),
    );
  });
});
