import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inventedModels,
  wrongAnswer,
  wrongSearch,
} from '../src/checks/assertions.js';
import { SnapshotError } from '../src/oracle/snapshot.js';
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
  ids: string[],
  failed = false,
): Call => ({
  round: 1,
  name: 'search_models',
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
  output: JSON.stringify({
    total: ids.length,
    models: ids.map((id) => ({ id })),
  }),
  failed,
});

const getModel = (id: string, failed = false): Call => ({
  round: 1,
  name: 'get_model',
  arguments: JSON.stringify({ slug: id }),
  output: JSON.stringify({ id, pricing: {} }),
  failed,
});

const success = (answer: string, toolCalls: Call[] = [], question = 'q') => ({
  question,
  answer,
  success: true,
  toolCalls,
});

/** The case C1: the cheapest paid model with 200000 tokens and tools, at a mix of 3. */
const oracle = {
  query: 'cheapest-blended',
  params: { minContext: 200000, supportedParameters: ['tools'], mix: 3 },
};
const required = {
  min_context_length: 200000,
  supported_parameters: ['tools'],
};
/** The case `search/cheapest-blended`. */
const c1 = {
  test: {
    metadata: {
      id: 'search/cheapest-blended',
      needsLookup: true,
      oracle,
      search: required,
    },
  },
};

const GOOD_ARGS = {
  min_context_length: 200000,
  supported_parameters: ['tools'],
};

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = () => vi.stubEnv('EVAL_CATALOG', snapshotFile());

describe('wrong-search', () => {
  it('passes a run whose search carried the constraints and surfaced an acceptable model', () => {
    withSnapshot();
    const run = success('t/g', [search(GOOD_ARGS, ['t/a', 't/g'])]);
    expect(wrongSearch(run, c1).pass).toBe(true);
  });

  it('fails a run whose lookups never surfaced an acceptable model, and names them', () => {
    withSnapshot();
    const result = wrongSearch(
      success('t/a', [search(GOOD_ARGS, ['t/a', 't/b'])]),
      c1,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'No tool output holds an acceptable model: t/g, t/h.',
    );
  });

  it('fails a call that dropped a constraint although it surfaced the model, and names the constraint', () => {
    withSnapshot();
    const result = wrongSearch(
      success('t/g', [search({ supported_parameters: ['tools'] }, ['t/g'])]),
      c1,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'No search_models call carries every constraint: min_context_length of at least 200000, supported_parameters with tools.',
    );
  });

  it.each([
    [
      'a list that holds the parameter among others',
      { ...GOOD_ARGS, supported_parameters: ['reasoning', 'tools'] },
      true,
    ],
    [
      'a list that lacks the parameter',
      { ...GOOD_ARGS, supported_parameters: ['reasoning'] },
      false,
    ],
    [
      'a context above the required one',
      { ...GOOD_ARGS, min_context_length: 300000 },
      true,
    ],
    [
      'a context equal to the required one',
      { ...GOOD_ARGS, min_context_length: 200000 },
      true,
    ],
    [
      'a context below the required one',
      { ...GOOD_ARGS, min_context_length: 199999 },
      false,
    ],
    [
      'a context that is the text of the required one',
      { ...GOOD_ARGS, min_context_length: '200000' },
      true,
    ],
    [
      'a context that is text with spaces, above the required one',
      { ...GOOD_ARGS, min_context_length: ' 3e5 ' },
      true,
    ],
    [
      'a context that is text below the required one',
      { ...GOOD_ARGS, min_context_length: '199999' },
      false,
    ],
    [
      'a context that is text and not a number',
      { ...GOOD_ARGS, min_context_length: 'plenty' },
      false,
    ],
    [
      'a context that is the text of a number too large to hold',
      { ...GOOD_ARGS, min_context_length: '1e999' },
      false,
    ],
    [
      'a context that is hex text of a number above the required one',
      { ...GOOD_ARGS, min_context_length: '0x30D40' },
      false,
    ],
    [
      'a context that is empty text',
      { ...GOOD_ARGS, min_context_length: '' },
      false,
    ],
    [
      'a parameter list that is text',
      { ...GOOD_ARGS, supported_parameters: 'tools' },
      false,
    ],
    ['no arguments at all', {}, false],
    ['arguments that are not JSON', 'not json', false],
    ['arguments that are the text null', 'null', false],
  ])('judges the search with %s', (_, args, passes) => {
    withSnapshot();
    expect(wrongSearch(success('t/g', [search(args, ['t/g'])]), c1).pass).toBe(
      passes,
    );
  });

  it('judges a number and its text alike', () => {
    withSnapshot();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.constantFrom('', ' ', '  '),
        (context, padding) => {
          const verdict = (sent: unknown) =>
            wrongSearch(
              success('t/g', [
                search({ ...GOOD_ARGS, min_context_length: sent }, ['t/g']),
              ]),
              c1,
            ).pass;
          expect(verdict(`${padding}${context}${padding}`)).toBe(
            verdict(context),
          );
        },
      ),
    );
  });

  it('is satisfied when one search carries the constraints, whatever the others did', () => {
    withSnapshot();
    const calls = [search({}, ['t/a']), search(GOOD_ARGS, ['t/g'])];
    expect(wrongSearch(success('t/g', calls), c1).pass).toBe(true);
  });

  it('judges a model that was read with get_model, with no search call to judge', () => {
    withSnapshot();
    expect(wrongSearch(success('t/g', [getModel('t/g')]), c1).pass).toBe(true);
    expect(wrongSearch(success('t/g', [getModel('t/a')]), c1).pass).toBe(false);
  });

  it('ignores a call that failed', () => {
    withSnapshot();
    const failedSearch = search(GOOD_ARGS, ['t/g'], true);
    expect(
      wrongSearch(success('t/g', [failedSearch, getModel('t/a')]), c1).pass,
    ).toBe(false);
    const badSearch = search({}, ['t/a'], true);
    expect(
      wrongSearch(success('t/g', [badSearch, getModel('t/g')]), c1).pass,
    ).toBe(true);
  });

  it('finds an acceptable model whatever the case of its id in the output', () => {
    withSnapshot();
    const run = success('x', [search(GOOD_ARGS, ['T/G'])]);
    expect(wrongSearch(run, c1).pass).toBe(true);
  });

  it('leaves a run with no answer or no lookup to an earlier class', () => {
    withSnapshot();
    expect(wrongSearch(success(''), c1).reason).toBe(
      'Left to an earlier class.',
    );
    expect(wrongSearch(success('t/g'), c1).pass).toBe(true);
    expect(wrongSearch(undefined, c1).pass).toBe(true);
  });

  it('passes a case that names no query', () => {
    withSnapshot();
    const none = { test: { metadata: { id: 'A1' } } };
    expect(wrongSearch(success('x', [getModel('t/a')]), none).reason).toBe(
      'No oracle query.',
    );
  });

  it('passes when the snapshot holds no acceptable model, which no run could find', () => {
    withSnapshot();
    const hard = {
      test: {
        metadata: {
          oracle: {
            ...oracle,
            params: { ...oracle.params, minContext: 9_000_000 },
          },
        },
      },
    };
    const result = wrongSearch(success('x', [getModel('t/a')]), hard);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The snapshot holds no acceptable model.');
  });

  it('says so when the run has no snapshot', () => {
    vi.stubEnv('EVAL_CATALOG', undefined as unknown as string);
    delete process.env.EVAL_CATALOG;
    expect(() => wrongSearch(success('x', [getModel('t/a')]), c1)).toThrow(
      SnapshotError,
    );
    expect(() => wrongSearch(success('x', [getModel('t/a')]), c1)).toThrow(
      /EVAL_CATALOG/,
    );
  });

  it('refuses an oracle declaration that is not a query', () => {
    withSnapshot();
    const bad = { test: { metadata: { oracle: { query: 'cheapest-bogus' } } } };
    expect(() => wrongSearch(success('x', [getModel('t/a')]), bad)).toThrow(
      /Unknown oracle query/,
    );
  });
});

describe('wrong-answer', () => {
  const surfaced = [search(GOOD_ARGS, ['t/a', 't/g', 't/h'])];

  it('passes an answer that names one acceptable model', () => {
    withSnapshot();
    expect(wrongAnswer(success('Use t/g.', surfaced), c1).pass).toBe(true);
    expect(
      wrongAnswer(success('t/a is dear. t/h is cheap.', surfaced), c1).pass,
    ).toBe(true);
  });

  it('fails an answer that names none, and lists the acceptable ones', () => {
    withSnapshot();
    const result = wrongAnswer(success('Use t/a.', surfaced), c1);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer names none of the acceptable models: t/g, t/h.',
    );
  });

  it('matches a whole model name, in any case', () => {
    withSnapshot();
    expect(wrongAnswer(success('Use T/G!', surfaced), c1).pass).toBe(true);
    expect(wrongAnswer(success('Use t/gx or t/hh.', surfaced), c1).pass).toBe(
      false,
    );
  });

  it('leaves a run whose search was wrong to wrong-search', () => {
    withSnapshot();
    const lost = success('Use t/a.', [search(GOOD_ARGS, ['t/a'])]);
    expect(wrongAnswer(lost, c1).reason).toBe('Left to wrong-search.');
    expect(wrongAnswer(lost, c1).pass).toBe(true);
    const loose = success('Use t/a.', [search({}, ['t/g'])]);
    expect(wrongAnswer(loose, c1).reason).toBe('Left to wrong-search.');
  });

  it('leaves a run with no answer or no lookup to an earlier class', () => {
    withSnapshot();
    expect(wrongAnswer(success(''), c1).pass).toBe(true);
    expect(wrongAnswer(success('Use t/a.'), c1).reason).toBe(
      'Left to an earlier class.',
    );
  });

  it('passes a case with no query, and one the snapshot cannot answer', () => {
    withSnapshot();
    expect(
      wrongAnswer(success('x', surfaced), { test: { metadata: {} } }).reason,
    ).toBe('No oracle query.');
    const hard = {
      test: {
        metadata: {
          oracle: {
            ...oracle,
            params: { ...oracle.params, minContext: 9_000_000 },
          },
        },
      },
    };
    expect(wrongAnswer(success('x', surfaced), hard).reason).toBe(
      'The snapshot holds no acceptable model.',
    );
  });
});

describe('invented-data with the authors of the snapshot', () => {
  it('judges a model whose author the snapshot knows, although no tool output named that author', () => {
    vi.stubEnv(
      'EVAL_CATALOG',
      snapshotFile([
        {
          id: 'openai/gpt-5',
          contextLength: 1,
          supportedParameters: [],
          inputModalities: [],
          outputModalities: [],
          inputPrice: 1,
          outputPrice: 1,
        },
        {
          id: 'a/b',
          contextLength: 1,
          supportedParameters: [],
          inputModalities: [],
          outputModalities: [],
          inputPrice: 1,
          outputPrice: 1,
        },
      ]),
    );
    const calls = [getModel('a/b')];
    const result = inventedModels(success('Use openai/gpt-9.', calls), {});
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('No source holds: openai/gpt-9.');
  });

  it('still ignores a slash between words whose first word is no author', () => {
    withSnapshot();
    expect(
      inventedModels(success('input/output and 24/7', [getModel('t/a')]), {})
        .pass,
    ).toBe(true);
  });
});

describe('the search checks, for any output and any case', () => {
  it('never throw on a run, whatever it holds, and return a verdict', () => {
    withSnapshot();
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [wrongSearch, wrongAnswer]) {
          let result: ReturnType<typeof wrongSearch> | undefined;
          try {
            result = check(output, context as never);
          } catch (error) {
            // A case that declares something unreadable, or a query the snapshot cannot run, is the only thing that may throw.
            expect(String(error)).toMatch(
              /case|oracle|query|snapshot|EVAL_CATALOG/i,
            );
          }
          if (result) expect(result.score).toBe(result.pass ? 1 : 0);
        }
      }),
    );
  });
});

describe('the wording of the search verdicts', () => {
  it('lists up to five acceptable models, and counts the rest', () => {
    const models = Array.from({ length: 7 }, (_, index) => ({
      id: `m/${index}`,
      contextLength: 300000,
      supportedParameters: ['tools'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      inputPrice: 1,
      outputPrice: 1,
    }));
    vi.stubEnv('EVAL_CATALOG', snapshotFile(models));
    const lost = success('x', [getModel('z/z')]);
    expect(wrongSearch(lost, c1).reason).toBe(
      'No tool output holds an acceptable model: m/0, m/1, m/2, m/3, m/4 and 2 more.',
    );
    vi.stubEnv('EVAL_CATALOG', snapshotFile(models.slice(0, 5)));
    expect(wrongSearch(lost, c1).reason).toBe(
      'No tool output holds an acceptable model: m/0, m/1, m/2, m/3, m/4.',
    );
  });

  it('says every constraint a search dropped, a list as its members joined', () => {
    withSnapshot();
    const wide = {
      test: {
        metadata: {
          oracle,
          search: {
            min_context_length: 1,
            supported_parameters: ['tools', 'seed'],
          },
        },
      },
    };
    const result = wrongSearch(
      success('t/g', [search({ supported_parameters: ['tools'] }, ['t/g'])]),
      wide,
    );
    expect(result.reason).toBe(
      'No search_models call carries every constraint: min_context_length of at least 1, supported_parameters with tools, seed.',
    );
  });

  it('asks for every member of a required list, not one of them', () => {
    withSnapshot();
    const both = {
      test: {
        metadata: {
          oracle,
          search: { supported_parameters: ['tools', 'seed'] },
        },
      },
    };
    const onlyTools = success('t/g', [
      search({ supported_parameters: ['tools'] }, ['t/g']),
    ]);
    expect(wrongSearch(onlyTools, both).pass).toBe(false);
    const both2 = success('t/g', [
      search({ supported_parameters: ['seed', 'tools'] }, ['t/g']),
    ]);
    expect(wrongSearch(both2, both).pass).toBe(true);
  });

  it('says both faults, one after the other, when the search found nothing and sent nothing', () => {
    withSnapshot();
    const result = wrongSearch(success('x', [search({}, ['t/a'])]), c1);
    expect(result.reason).toBe(
      'No tool output holds an acceptable model: t/g, t/h. No search_models call carries every constraint: min_context_length of at least 200000, supported_parameters with tools.',
    );
  });

  it('says what a good search and a good answer did', () => {
    withSnapshot();
    const good = success('t/g', [search(GOOD_ARGS, ['t/g'])]);
    expect(wrongSearch(good, c1).reason).toBe(
      'The lookups surfaced an acceptable model with the constraints.',
    );
    expect(wrongAnswer(good, c1).reason).toBe(
      'The answer names an acceptable model.',
    );
  });

  it('reads each tool output as a text of its own', () => {
    withSnapshot();
    const apart = [
      { ...getModel('t/a'), output: 'prefix' },
      { ...getModel('t/g'), output: 't/g' },
    ];
    expect(wrongSearch(success('t/g', apart), c1).pass).toBe(true);
  });
});
