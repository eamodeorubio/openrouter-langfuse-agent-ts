import { readCase } from './caseSpec.js';
import { slugTokens } from './slugs.js';
import { answered, type Check, fail, pass } from './verdict.js';

/** Phrases that state what the answer took for granted, matched in any case. */
const ASSUMPTION = [/assum/, /depends/, /if you/, /based on/, /i'll take/];

/** unstated-assumption: the question leaves something out, and the answer neither asks for it nor says what it assumed. */
export const assumptionStated: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to an earlier class.');
  const { underspecified, assumes } = readCase(context);
  if (!underspecified) return pass('The question is not under-specified.');
  if (run.answer.includes('?')) return pass('The answer asks a question.');
  // A model often writes the typographic apostrophe, as in I’ll take.
  const answer = run.answer.toLowerCase().replaceAll('’', "'");
  if (ASSUMPTION.some((phrase) => phrase.test(answer))) {
    return pass('The answer states an assumption.');
  }
  if (
    assumes !== undefined &&
    slugTokens(run.answer).some((slug) =>
      slug.startsWith(assumes.toLowerCase()),
    )
  ) {
    return pass('The answer names the assumed model.');
  }
  return fail('The answer asks no question and states no assumption.');
};
