import { isObject } from './json.js';

/** The environment variable that tells the hook to drop the rubrics of weight 0, which the runner passes. Absent when the run keeps every assertion. */
export const SKIP_RUBRICS_ENV = 'EVAL_SKIP_WEIGHTLESS_RUBRICS';

/** An `llm-rubric` whose weight is the number 0. A rubric with no `weight` has the weight 1 for promptfoo, and stays. */
const isWeightlessRubric = (assertion: unknown): boolean =>
  isObject(assertion) &&
  assertion.type === 'llm-rubric' &&
  assertion.weight === 0;

/** The test or default test with the rubrics of weight 0 left out of its `assert`. One without a list of assertions comes back as it was. */
const withoutIn = (test: unknown): unknown => {
  if (!isObject(test) || !Array.isArray(test.assert)) return test;
  return {
    ...test,
    assert: test.assert.filter((assertion) => !isWeightlessRubric(assertion)),
  };
};

/**
 * The suite without its judge rubrics of weight 0, in `defaultTest` and in
 * every case. A rubric of weight 0 records a score and never decides a run,
 * so a run that does not read the scores need not ask for them. Everything
 * else stays as it was, the other assertions in their order. The suite it was
 * given is not modified.
 */
export const withoutWeightlessRubrics = (suite: unknown): unknown => {
  if (!isObject(suite)) return suite;
  return {
    ...suite,
    ...(suite.defaultTest === undefined
      ? {}
      : { defaultTest: withoutIn(suite.defaultTest) }),
    ...(Array.isArray(suite.tests)
      ? { tests: suite.tests.map(withoutIn) }
      : {}),
  };
};
