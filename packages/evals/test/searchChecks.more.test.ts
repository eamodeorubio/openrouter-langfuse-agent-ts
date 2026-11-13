import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countStated,
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

const call = (name: string, args: unknown, output: unknown): Call => ({
  round: 1,
  name,
  arguments: JSON.stringify(args),
  output: JSON.stringify(output),
  failed: false,
});
const search = (args: unknown, output: unknown = { total: 0, models: [] }) =>
  call('search_models', args, output);

const success = (answer: string, toolCalls: Call[]) => ({
  question: 'q',
  answer,
  success: true,
  toolCalls,
});
const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

afterEach(() => vi.unstubAllEnvs());

describe('a text requirement that a search did not meet', () => {
  it('is named with its value', () => {
    const result = searchArguments(
      success('x', [search({ sort: 'newest' })]),
      meta({ search: { sort: 'pricing-low-to-high' } }),
    );
    expect(result.reason).toBe(
      'No search_models call carries every constraint: sort of pricing-low-to-high.',
    );
  });
});

describe('a call that is not a search', () => {
  const WIDE = { min_context_length: 1, supported_parameters: ['tools'] };

  it('does not carry the filters of a search, whatever arguments it has', () => {
    const run = success('x', [call('get_model', WIDE, { id: 'a/b' })]);
    expect(searchArguments(run, meta({ search: WIDE })).pass).toBe(false);
  });

  it('is not a search to count, and needs no sort', () => {
    const run = success('x', [
      search({ sort: 'a' }),
      call('get_model', {}, { id: 'a/b' }),
    ]);
    expect(singleSearch(run, meta({})).pass).toBe(true);
    expect(singleSearch(run, meta({})).reason).toBe(
      'One search with a sort answered the question.',
    );
  });

  it('is not a search whose first model the answer must name', () => {
    const run = success('b/y', [
      call('get_model', {}, { models: [{ id: 'a/x' }] }),
      search({ sort: 'a' }, { models: [{ id: 'b/y' }] }),
    ]);
    expect(topOfSearch(run, meta({ search: { sort: 'a' } })).pass).toBe(true);
  });
});

describe('a case that declares nothing to require', () => {
  it('searchArguments has no search to require when the declaration is empty', () => {
    const run = success('x', [call('get_model', {}, { id: 'a/b' })]);
    expect(searchArguments(run, meta({ search: {} })).reason).toBe(
      'No search required.',
    );
  });

  it('topOfSearch reads the first search without asking for a filter', () => {
    const run = success('x', [call('get_model', {}, { id: 'a/b' })]);
    expect(topOfSearch(run, meta({})).reason).toBe(
      'The search listed no model.',
    );
  });
});

describe('the first model a search listed', () => {
  const sorted = meta({ search: { sort: 's' } });

  it.each([
    ['an entry with no id', [{ name: 'x' }]],
    ['an id that is not text', [{ id: 7 }]],
    ['an entry that is not an object', ['a/x']],
    ['no list of models', 'many'],
    ['an empty list', []],
  ])('is none for %s', (_, models) => {
    const run = success('anything', [search({ sort: 's' }, { models })]);
    expect(topOfSearch(run, sorted).reason).toBe('The search listed no model.');
  });
});

describe('the counts a run is judged by', () => {
  const oracle = {
    query: 'matching',
    params: { minContext: 250000, supportedParameters: ['tools'] },
  };
  const filters = {
    min_context_length: 250000,
    supported_parameters: ['tools'],
  };
  const counting = meta({ oracle, search: filters });
  // The table of the oracle spec holds four such models.

  it('are listed in ascending order, the count of the snapshot among them', () => {
    vi.stubEnv('EVAL_CATALOG', snapshotFile());
    const run = success('There are 99.', [search(filters, { total: 2 })]);
    expect(countStated(run, counting).reason).toBe(
      'The answer states none of the counts: 2, 4.',
    );
  });

  it('leave out a total that is not a number', () => {
    vi.stubEnv('EVAL_CATALOG', snapshotFile());
    for (const total of ['many', null, undefined, {}]) {
      const run = success('There are 99.', [search(filters, { total })]);
      expect(countStated(run, counting).reason).toBe(
        'The answer states none of the counts: 4.',
      );
    }
  });

  it('count once a total that equals the count of the snapshot', () => {
    vi.stubEnv('EVAL_CATALOG', snapshotFile());
    const run = success('There are 99.', [search(filters, { total: 4 })]);
    expect(countStated(run, counting).reason).toBe(
      'The answer states none of the counts: 4.',
    );
  });
});
