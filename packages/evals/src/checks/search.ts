import { isObject, parseJson } from '../json.js';
import { currentSnapshot } from '../oracle/catalog.js';
import { runQuery } from '../oracle/queries.js';
import { type Oracle, readCase } from './caseSpec.js';
import { type Success, successfulCalls } from './run.js';
import { slugTokens } from './slugs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

const SEARCH_TOOL = 'search_models';
const LISTED = 5;

const listed = (slugs: string[]): string =>
  slugs.length <= LISTED
    ? slugs.join(', ')
    : `${slugs.slice(0, LISTED).join(', ')} and ${slugs.length - LISTED} more`;

const describeRequirement = (
  name: string,
  required: number | string[],
): string =>
  typeof required === 'number'
    ? `${name} of at least ${required}`
    : `${name} with ${required.join(', ')}`;

const carries = (
  call: { arguments: string },
  search: Oracle['search'],
): boolean => {
  const args = parseJson(call.arguments);
  if (!isObject(args)) return false;
  return Object.entries(search).every(([name, required]) => {
    const sent = args[name];
    return typeof required === 'number'
      ? typeof sent === 'number' && sent >= required
      : Array.isArray(sent) && required.every((item) => sent.includes(item));
  });
};

interface Assessment {
  acceptable: string[];
  /** The search found an acceptable model and sent every constraint. */
  sound: boolean;
  reason: string;
}

/** What the run's lookups say against what the snapshot accepts. */
const assess = (run: Success, oracle: Oracle): Assessment => {
  const acceptable = runQuery(
    oracle.query,
    currentSnapshot().models,
    oracle.params,
  ).map((slug) => slug.toLowerCase());
  const calls = successfulCalls(run);
  const surfaced = new Set(
    slugTokens(calls.map((call) => call.output).join('\n')),
  );
  const found = acceptable.some((slug) => surfaced.has(slug));
  const searches = calls.filter((call) => call.name === SEARCH_TOOL);
  const sent =
    searches.length === 0 ||
    searches.some((call) => carries(call, oracle.search));

  const reasons = [
    ...(found
      ? []
      : [`No tool output holds an acceptable model: ${listed(acceptable)}.`]),
    ...(sent
      ? []
      : [
          `No ${SEARCH_TOOL} call carries every constraint: ${Object.entries(
            oracle.search,
          )
            .map(([name, required]) => describeRequirement(name, required))
            .join(', ')}.`,
        ]),
  ];
  return { acceptable, sound: found && sent, reason: reasons.join(' ') };
};

/** wrong-search: the lookups could not surface an acceptable model, or no search sent the constraints. */
export const wrongSearch: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { oracle } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  const assessment = assess(run, oracle);
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
  const { oracle } = readCase(context);
  if (!oracle) return pass('No oracle query.');
  const assessment = assess(run, oracle);
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
