import { finite, isObject, parseJson } from '../json.js';
import { readCase } from './caseSpec.js';
import { matchesCount } from './figures.js';
import {
  acceptableSlugs,
  carries,
  droppedFilters,
  searchCalls,
  sentFilters,
} from './search.js';
import { slugTokens } from './slugs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

/** Phrases that say that no model matches. An answer that holds one of them, in any case, says so. */
const NO_MODEL = [
  /\bno models?\b/,
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

/** The id of the first model a search output lists. */
const firstListed = (output: string): string | undefined => {
  const body = parseJson(output);
  const models = isObject(body) ? body.models : undefined;
  const first = Array.isArray(models) ? models[0] : undefined;
  return isObject(first) && typeof first.id === 'string' ? first.id : undefined;
};

/** wrong-answer: the first search listed a model first, and the answer does not name it. */
export const topOfSearch: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { search = {} } = readCase(context);
  if (!sentFilters(run, search)) return pass('Left to wrong-search.');
  const [first] = searchCalls(run);
  const top = first ? firstListed(first.output) : undefined;
  if (top === undefined) return pass('The search listed no model.');
  return new Set(slugTokens(run.answer)).has(top.toLowerCase())
    ? pass('The answer names the model the search listed first.')
    : fail(
        `The answer does not name the model the search listed first: ${top}.`,
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
