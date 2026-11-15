import { readCase } from './caseSpec.js';
import { matchesCost } from './figures.js';
import { lookupMade, successfulCalls } from './run.js';
import { answered, type Check, fail, pass } from './verdict.js';

const LOOKUPS = ['get_model', 'search_models'];

/** arithmetic-in-head: the case needs arithmetic and no calculate call succeeded. */
export const arithmeticInHead: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to run-failed.');
  if (readCase(context).needsArithmetic !== true) {
    return pass('The case needs no arithmetic.');
  }
  return successfulCalls(run).some((call) => call.name === 'calculate')
    ? pass('A calculate call succeeded.')
    : fail('The case needs arithmetic and no calculate call succeeded.');
};

/** needless-lookup: the question held the data, and the run looked something up anyway. */
export const needlessLookup: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to run-failed.');
  if (readCase(context).needsLookup !== false) {
    return pass('The case may look data up.');
  }
  const called = [
    ...new Set(
      run.toolCalls
        .map((call) => call.name)
        .filter((name) => LOOKUPS.includes(name)),
    ),
  ];
  return called.length === 0
    ? pass('The run made no lookup.')
    : fail(
        `The question held the data, and the run called ${called.join(', ')}.`,
      );
};

/** wrong-value: the answer lacks the cost the case expects, within one percent. */
export const statedCost: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to run-failed.');
  const { expectedCost, needsLookup } = readCase(context);
  if (expectedCost === undefined) {
    return pass('The case expects no cost.');
  }
  if (needsLookup === true && !lookupMade(run)) {
    return pass('Left to memory-answer.');
  }
  return matchesCost(run.answer, expectedCost)
    ? pass(`The answer states an amount within 1% of ${expectedCost}.`)
    : fail(`The answer states no amount within 1% of ${expectedCost}.`);
};
