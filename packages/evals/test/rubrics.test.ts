import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { withoutWeightlessRubrics } from '../src/rubrics.js';

const rubric = (metric: string, weight?: unknown) => ({
  type: 'llm-rubric',
  metric,
  ...(weight === undefined ? {} : { weight }),
  threshold: 0.5,
  value: 'Is it good?',
});
const check = (metric: string) => ({
  type: 'javascript',
  metric,
  value: 'true',
});

/** The assertions of the first test of a suite, after the removal. */
const assertsOf = (suite: unknown, index = 0) =>
  (suite as { tests: { assert?: unknown[] }[] }).tests[index]?.assert;
const defaultsOf = (suite: unknown) =>
  (suite as { defaultTest: { assert?: unknown[] } }).defaultTest.assert;

describe('withoutWeightlessRubrics', () => {
  it('removes an llm-rubric of weight 0 from a case and from defaultTest', () => {
    const suite = {
      defaultTest: { assert: [check('a'), rubric('judge-x', 0)] },
      tests: [{ assert: [rubric('judge-y', 0), check('b')] }],
    };
    const result = withoutWeightlessRubrics(suite);
    expect(defaultsOf(result)).toEqual([check('a')]);
    expect(assertsOf(result)).toEqual([check('b')]);
  });

  it('keeps a rubric of weight 1 and a rubric with no weight key', () => {
    const suite = {
      tests: [
        {
          assert: [
            rubric('judge-a', 1),
            rubric('judge-b'),
            rubric('judge-c', 0),
          ],
        },
      ],
    };
    expect(assertsOf(withoutWeightlessRubrics(suite))).toEqual([
      rubric('judge-a', 1),
      rubric('judge-b'),
    ]);
  });

  it('counts only the number 0 as weight 0', () => {
    const kept = [rubric('a', '0'), rubric('b', null), rubric('c', 0.1)];
    const suite = { tests: [{ assert: [...kept, rubric('d', 0)] }] };
    expect(assertsOf(withoutWeightlessRubrics(suite))).toEqual(kept);
  });

  it('keeps an assertion of another type at weight 0', () => {
    const odd = { type: 'contains', value: 'x', weight: 0 };
    const suite = { tests: [{ assert: [odd, { ...check('a'), weight: 0 }] }] };
    expect(assertsOf(withoutWeightlessRubrics(suite))).toEqual([
      odd,
      { ...check('a'), weight: 0 },
    ]);
  });

  it('keeps the javascript checks in their order', () => {
    const suite = {
      defaultTest: { assert: [check('1'), rubric('r', 0), check('2')] },
      tests: [
        { assert: [check('3'), rubric('r', 0), check('4'), rubric('s', 0)] },
      ],
    };
    const result = withoutWeightlessRubrics(suite);
    expect(defaultsOf(result)).toEqual([check('1'), check('2')]);
    expect(assertsOf(result)).toEqual([check('3'), check('4')]);
  });

  it('adds no key to a suite that lacks defaultTest or tests', () => {
    const bare = { description: 'bare' };
    expect(withoutWeightlessRubrics(bare)).toStrictEqual(bare);
    expect(withoutWeightlessRubrics({ tests: [] })).toStrictEqual({
      tests: [],
    });
  });

  it('leaves a case with no assert alone, with no assert added', () => {
    const suite = { tests: [{ description: 'bare', vars: { q: 'x' } }] };
    const result = withoutWeightlessRubrics(suite);
    expect(result).toEqual(suite);
    expect(assertsOf(result)).toBeUndefined();
  });

  it('leaves every other field of the suite and of each case as it was', () => {
    const suite = {
      description: 'a suite',
      providers: [{ id: 'p' }],
      defaultTest: {
        options: { provider: { id: 'judge' } },
        vars: { model: ['m/one'] },
        assert: [rubric('r', 0)],
      },
      tests: [
        {
          description: 'c',
          metadata: { id: 'x', set: ['core'] },
          vars: { question: 'q' },
          assert: [rubric('r', 0), check('k')],
        },
      ],
    };
    expect(withoutWeightlessRubrics(suite)).toEqual({
      ...suite,
      defaultTest: { ...suite.defaultTest, assert: [] },
      tests: [{ ...suite.tests[0], assert: [check('k')] }],
    });
  });

  it('does not modify the suite it was given', () => {
    const suite = {
      defaultTest: { assert: [rubric('r', 0)] },
      tests: [{ assert: [rubric('r', 0), check('k')] }],
    };
    const before = structuredClone(suite);
    withoutWeightlessRubrics(suite);
    expect(suite).toEqual(before);
  });

  it.each([
    ['null', null],
    ['text', 'suite'],
    ['a list', []],
    ['an empty object', {}],
    ['tests that are not a list', { tests: 'file://cases/*.yaml' }],
    ['a case that is not an object', { tests: [null, 3] }],
    ['an assert that is not a list', { tests: [{ assert: 'x' }] }],
    [
      'an assertion that is not an object',
      { tests: [{ assert: [null, 'x'] }] },
    ],
  ])('returns %s as it is', (_name, suite) => {
    expect(withoutWeightlessRubrics(suite)).toEqual(suite);
  });
});

describe('withoutWeightlessRubrics, for any assertions', () => {
  const weight = fc.constantFrom<unknown>(undefined, 0, -0, 1, 0.5, '0', null);
  const assertion = fc.record({
    type: fc.constantFrom('javascript', 'llm-rubric', 'contains'),
    metric: fc.string({ maxLength: 4 }),
    weight,
  });
  const assertions = fc.array(assertion, { maxLength: 8 });
  const suite = fc.record({
    defaultTest: fc.record({ assert: assertions }),
    tests: fc.array(fc.record({ assert: assertions }), { maxLength: 4 }),
  });
  const isWeightless = (a: { type: string; weight?: unknown }) =>
    a.type === 'llm-rubric' && a.weight === 0;

  /** Whether `small` is `big` with some elements removed, in the order they were. */
  const isSubsequence = (small: unknown[], big: unknown[]) => {
    let at = 0;
    for (const item of big) {
      if (at < small.length && Object.is(small[at], item)) at++;
    }
    return at === small.length;
  };

  it('leaves the assertions of each case a subsequence of those before', () => {
    fc.assert(
      fc.property(suite, (given) => {
        const result = withoutWeightlessRubrics(given);
        given.tests.forEach((test, i) => {
          expect(
            isSubsequence(assertsOf(result, i) as unknown[], test.assert),
          ).toBe(true);
        });
        expect(
          isSubsequence(
            defaultsOf(result) as unknown[],
            given.defaultTest.assert,
          ),
        ).toBe(true);
      }),
    );
  });

  it('removes nothing but an llm-rubric of weight 0, and all of those', () => {
    fc.assert(
      fc.property(suite, (given) => {
        const result = withoutWeightlessRubrics(given);
        given.tests.forEach((test, i) => {
          expect(assertsOf(result, i)).toEqual(
            test.assert.filter((a) => !isWeightless(a)),
          );
        });
        expect(defaultsOf(result)).toEqual(
          given.defaultTest.assert.filter((a) => !isWeightless(a)),
        );
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(suite, (given) => {
        const once = withoutWeightlessRubrics(given);
        expect(withoutWeightlessRubrics(once)).toEqual(once);
      }),
    );
  });

  it('never modifies its argument', () => {
    fc.assert(
      fc.property(suite, (given) => {
        const before = structuredClone(given);
        withoutWeightlessRubrics(given);
        expect(given).toEqual(before);
      }),
    );
  });
});
