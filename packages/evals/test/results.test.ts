import { describe, expect, it } from 'vitest';
import { ResultsFormatError, readRuns } from '../src/report/results.js';

/** An entry of promptfoo's results, as a run that passed. `over` replaces its top-level fields. */
const entry = (over: Record<string, unknown> = {}) => ({
  vars: { model: 'm/one', question: 'What is a token?' },
  testCase: { description: 'Describes the case', metadata: { id: 'A1' } },
  success: true,
  failureReason: 0,
  latencyMs: 5,
  namedScores: {},
  response: {
    output: { success: true, toolCalls: [{ round: 1 }, { round: 2 }] },
    cost: 0.5,
  },
  gradingResult: { componentResults: [] },
  ...over,
});

const read = (entries: unknown[], extra: Record<string, unknown> = {}) =>
  readRuns({ results: { results: entries }, ...extra });

const first = (over: Record<string, unknown> = {}) => {
  const [run] = read([entry(over)]).runs;
  if (!run) throw new Error('no run');
  return run;
};

describe('a file that is not a results file', () => {
  it.each([
    ['null', null],
    ['a string', 'text'],
    ['an object with no results', {}],
    ['results that is not an object', { results: 3 }],
    ['results.results that is not a list', { results: { results: {} } }],
  ])('is refused when it is %s', (_, file) => {
    expect(() => readRuns(file)).toThrow(ResultsFormatError);
    expect(() => readRuns(file)).toThrow(/results\.results is not a list/);
  });

  it('is refused when a result is not an object', () => {
    expect(() => read([entry(), 'oops'])).toThrow(
      /A result in the results file is not an object/,
    );
    expect(() => read([null])).toThrow(ResultsFormatError);
  });

  it('is read as no runs when the list is empty', () => {
    expect(read([]).runs).toEqual([]);
  });
});

describe('the model and the case of a run', () => {
  it('are read from vars.model and metadata.id', () => {
    expect(first()).toMatchObject({ model: 'm/one', caseName: 'A1' });
  });

  it.each([
    ['is absent', { vars: { question: 'q' } }],
    ['is empty', { vars: { model: '', question: 'q' } }],
    ['is not text', { vars: { model: 3, question: 'q' } }],
  ])('names the model "(no model)" when vars.model %s', (_, over) => {
    expect(first(over).model).toBe('(no model)');
  });

  it('falls back from the id to the description, to the question, to a placeholder', () => {
    const noId = { description: 'Says what it tests' };
    expect(first({ testCase: noId }).caseName).toBe('Says what it tests');
    expect(
      first({ testCase: { metadata: { id: '' }, ...noId } }).caseName,
    ).toBe('Says what it tests');
    expect(first({ testCase: {} }).caseName).toBe('What is a token?');
    expect(first({ testCase: undefined }).caseName).toBe('What is a token?');
    expect(first({ testCase: {}, vars: { model: 'm/one' } }).caseName).toBe(
      '(unnamed case)',
    );
    expect(
      first({ testCase: {}, vars: { model: 'm/one', question: '' } }).caseName,
    ).toBe('(unnamed case)');
  });
});

describe('a provider error', () => {
  it('is failureReason 2', () => {
    expect(first({ failureReason: 2, success: false }).error).toBe(true);
  });

  it('is a response that holds an error when there is no failureReason', () => {
    expect(
      first({ failureReason: undefined, response: { error: 'boom' } }).error,
    ).toBe(true);
    expect(
      first({ failureReason: undefined, response: { output: {} } }).error,
    ).toBe(false);
  });

  it('is not a failed check, whose record also holds an error text', () => {
    const run = first({
      failureReason: 1,
      success: false,
      error: 'Custom function returned false',
      response: { error: 'also text', output: { success: true } },
    });
    expect(run.error).toBe(false);
  });

  it('is not a passing run', () => {
    expect(first({ failureReason: 0 }).error).toBe(false);
  });
});

describe('whether a run passed', () => {
  it('needs success true', () => {
    expect(first().passed).toBe(true);
    expect(first({ success: false }).passed).toBe(false);
    expect(first({ success: undefined }).passed).toBe(false);
  });

  it('is never so for a provider error', () => {
    expect(first({ failureReason: 2, success: true }).passed).toBe(false);
  });
});

describe('the failed checks of a run', () => {
  const component = (metric: unknown, pass: unknown) => ({
    pass,
    assertion: { metric },
  });
  const grading = (...componentResults: unknown[]) => ({ componentResults });

  it('are the metrics of the components that did not pass', () => {
    const run = first({
      gradingResult: grading(
        component('memory-answer', false),
        component('wrong-value', false),
        component('run-failed', true),
      ),
    });
    expect(run.failures).toEqual(['memory-answer', 'wrong-value']);
  });

  it('leave out a failing component without a metric, and one that only has no pass', () => {
    const run = first({
      gradingResult: grading(
        component(undefined, false),
        component('', false),
        component('wrong-value', undefined),
        'not an object',
        null,
      ),
    });
    expect(run.failures).toEqual([]);
  });

  it('leave out the judge rubrics', () => {
    const run = first({
      gradingResult: grading(
        component('judge-grounding', false),
        component('wrong-value', false),
      ),
    });
    expect(run.failures).toEqual(['wrong-value']);
  });

  it.each([
    ['no grading', null],
    ['components that are not a list', { componentResults: {} }],
    ['no components', {}],
  ])('are empty with %s', (_, gradingResult) => {
    expect(first({ gradingResult }).failures).toEqual([]);
  });

  it('are empty for a provider error', () => {
    const run = first({
      failureReason: 2,
      gradingResult: grading(component('wrong-value', false)),
    });
    expect(run.failures).toEqual([]);
  });
});

describe('the cost of a run', () => {
  it('is the cost the response reported, 0 included', () => {
    expect(first().cost).toBe(0.5);
    expect(first({ response: { output: {}, cost: 0 } }).cost).toBe(0);
  });

  it.each([
    ['absent', { output: {} }],
    ['text', { output: {}, cost: '0.5' }],
    ['not finite', { output: {}, cost: Number.NaN }],
  ])('is left out when the response cost is %s', (_, response) => {
    expect('cost' in first({ response })).toBe(false);
  });

  it('is left out for a provider error, whatever its record holds', () => {
    const run = first({
      failureReason: 2,
      cost: 0,
      response: { error: 'x', cost: 0.3 },
    });
    expect('cost' in run).toBe(false);
  });
});

describe('the latency of a run', () => {
  it('is read, and left out when it is not a number', () => {
    expect(first({ latencyMs: 0 }).latencyMs).toBe(0);
    expect(first({ latencyMs: 12.5 }).latencyMs).toBe(12.5);
    expect('latencyMs' in first({ latencyMs: '5' })).toBe(false);
    expect('latencyMs' in first({ latencyMs: undefined })).toBe(false);
  });

  it('is kept for a provider error', () => {
    expect(first({ failureReason: 2, latencyMs: 300 }).latencyMs).toBe(300);
  });
});

describe('the tool rounds of a run', () => {
  const withCalls = (toolCalls: unknown) => ({
    response: { output: { success: true, toolCalls } },
  });

  it('are the highest round of its calls', () => {
    expect(
      first(withCalls([{ round: 1 }, { round: 3 }, { round: 2 }])).rounds,
    ).toBe(3);
  });

  it('are 0 without calls or without a list of calls', () => {
    expect(first(withCalls([])).rounds).toBe(0);
    expect(first(withCalls(undefined)).rounds).toBe(0);
    expect(first(withCalls('none')).rounds).toBe(0);
  });

  it('skip a call whose round is not a number', () => {
    expect(
      first(withCalls([{ round: '9' }, { round: 2 }, {}, null])).rounds,
    ).toBe(2);
  });

  it('are absent when the output is not an object, and for a provider error', () => {
    expect('rounds' in first({ response: { output: 'text' } })).toBe(false);
    expect('rounds' in first({ response: {} })).toBe(false);
    expect(
      'rounds' in
        first({
          failureReason: 2,
          response: { output: { toolCalls: [{ round: 1 }] } },
        }),
    ).toBe(false);
  });
});

describe('the judge scores of a run', () => {
  const component = (metric: string, score: unknown, reason: unknown) => ({
    pass: true,
    score,
    reason,
    assertion: { type: 'llm-rubric', metric, weight: 0 },
  });
  const jev = (probability: number) =>
    `Jev Noul probability ${probability} < threshold 0.5`;
  const graded = (components: unknown[], over: Record<string, unknown> = {}) =>
    first({ gradingResult: { componentResults: components }, ...over });

  it('are the finite scores of the rubrics that Jev answered', () => {
    const run = graded([
      component('judge-relevance', 0.4, jev(0.4)),
      component('judge-grounding', 0, jev(0)),
      component(
        'judge-usefulness',
        1,
        'Jev Noul probability 1 >= threshold 0.5',
      ),
    ]);
    expect(run.judges).toEqual({
      'judge-relevance': 0.4,
      'judge-grounding': 0,
      'judge-usefulness': 1,
    });
  });

  it('leave out a rubric that Jev did not answer, although promptfoo records a score of 0 for it', () => {
    const run = graded(
      [
        component('judge-relevance', 0.4, jev(0.4)),
        component(
          'judge-grounding',
          0,
          'The state is 40000 bytes, over the limit of 32000: not graded.',
        ),
        component('judge-usefulness', 0, 'OPENROUTER_API_KEY is not set.'),
        component('judge-tool-usage', 0, 'TypeSafe API error: 500'),
      ],
      {
        namedScores: {
          'judge-relevance': 0.4,
          'judge-grounding': 0,
          'judge-usefulness': 0,
          'judge-tool-usage': 0,
        },
      },
    );
    expect(run.judges).toEqual({ 'judge-relevance': 0.4 });
  });

  it('list every rubric that was asked, answered or not, and no other metric', () => {
    const run = graded([
      component('judge-relevance', 0.4, jev(0.4)),
      component('judge-grounding', 0, 'OPENROUTER_API_KEY is not set.'),
      component('wrong-value', 1, 'ok'),
    ]);
    expect(run.rubrics).toEqual(['judge-relevance', 'judge-grounding']);
    expect(first({ gradingResult: undefined }).rubrics).toEqual([]);
    expect(
      graded([component('judge-x', 1, jev(1))], { failureReason: 2 }).rubrics,
    ).toEqual([]);
  });

  it('leave out what is not a finite score under a judge- name', () => {
    const run = graded([
      component('wrong-value', 1, jev(1)),
      component('judge-bad', 'high', jev(0.5)),
      component('judge-nan', Number.NaN, jev(0.5)),
      component('judge-null', null, jev(0.5)),
      component('judge-reasonless', 0.5, undefined),
      component(undefined as never, 0.5, jev(0.5)),
    ]);
    expect(run.judges).toEqual({});
  });

  it('are empty without components, and for a provider error', () => {
    expect(first({ gradingResult: undefined }).judges).toEqual({});
    expect(first({ gradingResult: { componentResults: 'x' } }).judges).toEqual(
      {},
    );
    expect(
      graded([component('judge-x', 1, jev(1))], { failureReason: 2 }).judges,
    ).toEqual({});
  });
});

describe('the threshold of each judge rubric', () => {
  const rubric = (metric: string, threshold: unknown, extra = {}) => ({
    pass: true,
    score: 0.6,
    reason: 'Jev Noul probability 0.6 >= threshold 0',
    assertion: { type: 'llm-rubric', metric, weight: 0, threshold, ...extra },
  });
  const thresholdsOf = (...components: unknown[]) =>
    read([entry({ gradingResult: { componentResults: components } })])
      .thresholds;

  it.each([0, 0.25, 0.7, 1])('is read when it is %s', (value) => {
    expect(thresholdsOf(rubric('judge-relevance', value))).toEqual({
      'judge-relevance': value,
    });
  });

  it.each([-0.01, 1.01, '0.5', Number.NaN, null, undefined])(
    'is %s, which is not a threshold, so the rubric has none',
    (value) => {
      expect(thresholdsOf(rubric('judge-relevance', value))).toEqual({});
    },
  );

  it('is read for each rubric, and for no check that is not a rubric', () => {
    expect(
      thresholdsOf(
        rubric('judge-relevance', 0.5),
        rubric('judge-usefulness', 0.7),
        rubric('judge-tool-usage', 0.73),
        {
          pass: true,
          score: 1,
          assertion: { metric: 'run-failed', threshold: 0.9 },
        },
      ),
    ).toEqual({
      'judge-relevance': 0.5,
      'judge-usefulness': 0.7,
      'judge-tool-usage': 0.73,
    });
  });

  it('is collected over all the runs, and a run with no rubric adds none', () => {
    const withRubric = entry({
      gradingResult: {
        componentResults: [rubric('judge-relevance', 0.5)],
      },
    });
    expect(read([entry(), withRubric]).thresholds).toEqual({
      'judge-relevance': 0.5,
    });
    expect(read([]).thresholds).toEqual({});
  });
});

describe('the wall time of the eval', () => {
  const file = (stats: unknown, runtimeOptions: unknown) => ({
    results: { results: [], stats },
    runtimeOptions,
  });

  it('is the duration promptfoo measured, and the concurrency it ran with', () => {
    expect(
      readRuns(file({ durationMs: 30815 }, { maxConcurrency: 4 })),
    ).toMatchObject({ wallTimeMs: 30815, concurrency: 4 });
  });

  it('is absent when the file has none', () => {
    const read = readRuns({ results: { results: [] } });
    expect('wallTimeMs' in read).toBe(false);
    expect('concurrency' in read).toBe(false);
  });

  it.each([
    ['text', '12'],
    ['not finite', Number.NaN],
    ['negative', -5],
  ])('leaves out a duration that is %s', (_, durationMs) => {
    expect('wallTimeMs' in readRuns(file({ durationMs }, {}))).toBe(false);
  });

  it('keeps a duration of zero, and leaves out a concurrency that is not a whole count of 1 or more', () => {
    expect(readRuns(file({ durationMs: 0 }, {})).wallTimeMs).toBe(0);
    for (const maxConcurrency of [0, -1, 2.5, '4', Number.NaN]) {
      expect('concurrency' in readRuns(file({}, { maxConcurrency }))).toBe(
        false,
      );
    }
    expect(readRuns(file({}, { maxConcurrency: 1 })).concurrency).toBe(1);
  });
});
