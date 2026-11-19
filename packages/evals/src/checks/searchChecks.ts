import { finite, isObject, parseJson } from '../json.js';
import { readCase } from './caseSpec.js';
import { matchesCount } from './figures.js';
import { acceptableSlugs } from './oracleSlugs.js';
import { type ListedModel, listedModels } from './outputs.js';
import { carries, droppedFilters, searchCalls, sentFilters } from './search.js';
import { slugTokens } from './slugs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

/** Phrases that say that no model matches. An answer that holds one of them, in any case, says so. */
const NO_MODEL = [
  /\bno (?:(?:single|one) )?models?\b/,
  /\bnone\b/,
  /\bdoes not exist\b/,
  /\bdoesn't exist\b/,
  /\bno such\b/,
  /\bno match/,
  /\bnot find\b/,
  /\bnothing\b/,
];

/** wrong-search: no successful search sent every filter the case requires. */
export const searchArguments: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { search } = readCase(context);
  if (!search || Object.keys(search).length === 0) {
    return pass('No search required.');
  }
  return sentFilters(run, search)
    ? pass('A search_models call carried every required filter.')
    : fail(droppedFilters(search));
};

/** phantom-match: no model in the snapshot matches the request, and the answer does not say so. */
export const phantomMatch: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle, search = {} } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  if (acceptableSlugs(oracle).length > 0) {
    return pass(
      'The snapshot holds a model that meets the request, so the case does not apply.',
    );
  }
  if (!sentFilters(run, search)) return pass('Left to wrong-search.');
  const answer = run.answer.toLowerCase();
  return NO_MODEL.some((phrase) => phrase.test(answer))
    ? pass('The answer says that no model matches.')
    : fail(
        'The snapshot holds no matching model, and the answer does not say so.',
      );
};

const hasSort = (call: { arguments: string }): boolean => {
  const args = parseJson(call.arguments);
  return isObject(args) && typeof args.sort === 'string' && args.sort !== '';
};

/** wasteful-search: the run searched more than once, or without a sort, when one sorted search answers. */
export const singleSearch: Check = (output) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const searches = searchCalls(run);
  if (searches.length > 1) {
    return fail(
      `The run made ${searches.length} searches, and one answers the question.`,
    );
  }
  return searches.some(hasSort)
    ? pass('One search with a sort answered the question.')
    : fail('No search_models call sent a sort.');
};

/** A model ties the first when it is listed with the same input price and output price. */
const tiesWith = (first: ListedModel, model: ListedModel): boolean =>
  typeof first.promptPrice === 'number' &&
  typeof first.completionPrice === 'number' &&
  model.promptPrice === first.promptPrice &&
  model.completionPrice === first.completionPrice;

/** Whether a listed model costs something: both prices are given and one is above 0. The rule of `paid_only`, copied from `isPaid` in `packages/cli/src/tools/priceSort.ts`: the evals judge the built CLI from outside and do not import it. */
const isPaid = (model: ListedModel): boolean =>
  typeof model.promptPrice === 'number' &&
  typeof model.completionPrice === 'number' &&
  (model.promptPrice > 0 || model.completionPrice > 0);

/** A question that asks for a paid model rules out the free and the unpriced, whether or not the search said `paid_only`. */
const asksForPaid = (question: string): boolean =>
  /\bpaid\s+models?\b/i.test(question);

/** wrong-answer: the first search listed a model first, and the answer names neither it nor a model that ties it. A question for a paid model skips the models that are not paid. */
export const topOfSearch: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { search = {} } = readCase(context);
  if (!sentFilters(run, search)) return pass('Left to wrong-search.');
  const [call] = searchCalls(run);
  const listed = call ? listedModels(call.output) : [];
  const [top, ...rest] = asksForPaid(run.question)
    ? listed.filter(isPaid)
    : listed;
  if (top === undefined) return pass('The search listed no model.');
  const named = new Set(slugTokens(run.answer));
  if (named.has(top.id)) {
    return pass('The answer names the model the search listed first.');
  }
  return rest.some((model) => tiesWith(top, model) && named.has(model.id))
    ? pass(
        'The answer names a model tied with the one the search listed first.',
      )
    : fail(
        `The answer does not name the model the search listed first: ${top.id}.`,
      );
};

/** The total a search output reports, when it is a number. */
const totalOf = (output: string): number[] => {
  const body = parseJson(output);
  const total = isObject(body) ? body.total : undefined;
  return finite(total) ? [total] : [];
};

/** wrong-value: the answer states neither the count of the snapshot nor the total a filtered search reported. */
export const countStated: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle, search = {} } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  if (!sentFilters(run, search)) return pass('Left to wrong-search.');
  const expected = acceptableSlugs(oracle).length;
  const reported = searchCalls(run)
    .filter((call) => carries(call, search))
    .flatMap((call) => totalOf(call.output));
  const counts = [...new Set([expected, ...reported])].sort((a, b) => a - b);
  return counts.some((count) => matchesCount(run.answer, count))
    ? pass(
        `The answer states a count the snapshot or the search supports: ${counts.join(', ')}.`,
      )
    : fail(`The answer states none of the counts: ${counts.join(', ')}.`);
};
