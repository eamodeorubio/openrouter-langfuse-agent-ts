import { isObject, parseJson } from '../json.js';
import { currentSnapshot } from '../oracle/catalog.js';
import { runQuery } from '../oracle/queries.js';
import { type Oracle, readCase, type SearchRequirements } from './caseSpec.js';
import { type Success, successfulCalls } from './run.js';
import { slugTokens } from './slugs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

export const SEARCH_TOOL = 'search_models';
const LISTED = 5;

const listed = (slugs: string[]): string =>
  slugs.length <= LISTED
    ? slugs.join(', ')
    : `${slugs.slice(0, LISTED).join(', ')} and ${slugs.length - LISTED} more`;

const describeRequirement = (
  name: string,
  required: number | string | string[],
): string => {
  if (typeof required === 'number') return `${name} of at least ${required}`;
  if (typeof required === 'string') return `${name} of ${required}`;
  return `${name} with ${required.join(', ')}`;
};

/** Whether a search call sent every required filter. */
export const carries = (
  call: { arguments: string },
  search: SearchRequirements,
): boolean => {
  const args = parseJson(call.arguments);
  if (!isObject(args)) return false;
  return Object.entries(search).every(([name, required]) => {
    const sent = args[name];
    if (typeof required === 'number') {
      return typeof sent === 'number' && sent >= required;
    }
    if (typeof required === 'string') return sent === required;
    return Array.isArray(sent) && required.every((item) => sent.includes(item));
  });
};

/** The successful `search_models` calls of a run. */
export const searchCalls = (run: Success) =>
  successfulCalls(run).filter((call) => call.name === SEARCH_TOOL);

/** The filters of a search, as a sentence. */
export const describeSearch = (search: SearchRequirements): string =>
  Object.entries(search)
    .map(([name, required]) => describeRequirement(name, required))
    .join(', ');

/** The message of a run that sent no search with every required filter. */
export const droppedFilters = (search: SearchRequirements): string =>
  `No ${SEARCH_TOOL} call carries every constraint: ${describeSearch(search)}.`;

/** Whether a case that requires filters got a search that sent them all. A case that requires none always does. */
export const sentFilters = (
  run: Success,
  search: SearchRequirements,
): boolean =>
  Object.keys(search).length === 0 ||
  searchCalls(run).some((call) => carries(call, search));

interface Assessment {
  acceptable: string[];
  /** The search found an acceptable model and sent every constraint. */
  sound: boolean;
  reason: string;
}

/** The slugs, in lower case, that the oracle query of a case accepts on the snapshot of the run. */
export const acceptableSlugs = (oracle: Oracle): string[] =>
  runQuery(oracle.query, currentSnapshot().models, oracle.params).map((slug) =>
    slug.toLowerCase(),
  );

/** What the run's lookups say against what the snapshot accepts. */
const assess = (
  run: Success,
  oracle: Oracle,
  search: SearchRequirements,
): Assessment => {
  const acceptable = acceptableSlugs(oracle);
  const calls = successfulCalls(run);
  const surfaced = new Set(
    slugTokens(calls.map((call) => call.output).join('\n')),
  );
  const found = acceptable.some((slug) => surfaced.has(slug));
  const searches = searchCalls(run);
  // A case that has an acceptable model leaves the run free to read it with
  // `get_model`, so a run with no search has no filter to judge. The checks
  // for a case with no model, a count or a sorted search ask for a search.
  const sent =
    searches.length === 0 || searches.some((call) => carries(call, search));

  const reasons = [
    ...(found
      ? []
      : [`No tool output holds an acceptable model: ${listed(acceptable)}.`]),
    ...(sent ? [] : [droppedFilters(search)]),
  ];
  return { acceptable, sound: found && sent, reason: reasons.join(' ') };
};

/** wrong-search: the lookups could not surface an acceptable model, or no search sent the constraints. */
export const wrongSearch: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle, search = {} } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  const assessment = assess(run, oracle, search);
  if (assessment.acceptable.length === 0) {
    return pass('The snapshot holds no acceptable model.');
  }
  return assessment.sound
    ? pass('The lookups surfaced an acceptable model with the constraints.')
    : fail(assessment.reason);
};

/** wrong-answer: the lookups were right and the answer names no acceptable model. */
export const wrongAnswer: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle, search = {} } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  const assessment = assess(run, oracle, search);
  if (assessment.acceptable.length === 0) {
    return pass('The snapshot holds no acceptable model.');
  }
  if (!assessment.sound) return pass('Left to wrong-search.');
  const named = new Set(slugTokens(run.answer));
  return assessment.acceptable.some((slug) => named.has(slug))
    ? pass('The answer names an acceptable model.')
    : fail(
        `The answer names none of the acceptable models: ${listed(assessment.acceptable)}.`,
      );
};
