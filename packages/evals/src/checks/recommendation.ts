import { readCase } from './caseSpec.js';
import { acceptableSlugs } from './oracleSlugs.js';
import { questionModels } from './questionModels.js';
import { slugTokens } from './slugs.js';
import { type Check, fail, judgeable, listed, pass } from './verdict.js';

/** bad-recommendation: the answer names no model, other than the ones the question names, that is within the budget. */
export const withinBudget: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  const asked = new Set(questionModels(run.question));
  const fits = acceptableSlugs(oracle).filter((slug) => !asked.has(slug));
  if (fits.length === 0) {
    return pass('The snapshot holds no model within the budget.');
  }
  const named = new Set(slugTokens(run.answer));
  return fits.some((slug) => named.has(slug))
    ? pass('The answer names a model within the budget.')
    : fail(`The answer names no model within the budget: ${listed(fits)}.`);
};
