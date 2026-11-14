import { isObject, parseJson } from '../json.js';
import { currentSnapshot } from '../oracle/catalog.js';
import { CaseError, readCase } from './caseSpec.js';
import { statesPrice } from './figures.js';
import { readModels } from './modelPrices.js';
import type { ToolCall } from './run.js';
import { successfulCalls } from './run.js';
import { answered, type Check, fail, judgeable, pass } from './verdict.js';

const GET_MODEL = 'get_model';

const slugOf = (call: ToolCall): string | undefined => {
  const args = parseJson(call.arguments);
  return isObject(args) && typeof args.slug === 'string'
    ? args.slug.toLowerCase()
    : undefined;
};

/** The rounds of the `get_model` calls for a model, in lower case, among the calls given. */
const roundsOf = (calls: readonly ToolCall[], slug: string): number[] =>
  calls
    .filter((call) => call.name === GET_MODEL && slugOf(call) === slug)
    .map((call) => call.round)
    .filter(Number.isFinite);

/** The earliest round in which a successful `get_model` call read the model. */
const firstRound = (
  calls: readonly ToolCall[],
  slug: string,
): number | undefined => {
  const rounds = roundsOf(calls, slug);
  return rounds.length === 0 ? undefined : Math.min(...rounds);
};

/** serial-lookups: independent models were read with `get_model` in separate rounds. */
export const serialLookups: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  if (!readCase(context).parallelLookups) {
    return pass('The lookups are not declared independent.');
  }
  const { read, unread } = readModels(run.question, run.toolCalls);
  if (unread.length > 0) return pass('Left to wrong-search.');
  const calls = successfulCalls(run);
  const rounds = read.flatMap(([slug]) => {
    const round = firstRound(calls, slug);
    return round === undefined ? [] : [[slug, round] as const];
  });
  if (rounds.length < 2) {
    return pass('Fewer than two models were read with get_model.');
  }
  const distinct = [...new Set(rounds.map(([, round]) => round))];
  return distinct.length === 1
    ? pass(`Every model was read in round ${distinct[0]}.`)
    : fail(
        `The models were read in separate rounds: ${rounds
          .map(([slug, round]) => `${slug} in round ${round}`)
          .join(', ')}.`,
      );
};

/** no-recovery: the lookup of a misspelled model failed, and no later round read the model it meant. */
export const recovered: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to an earlier class.');
  const { recovery } = readCase(context);
  if (!recovery) return pass('No recovery declared.');
  const misspelled = recovery.misspelled.toLowerCase();
  const correction = recovery.correction.toLowerCase();
  const reads = roundsOf(successfulCalls(run), correction);
  if (reads.length === 0) {
    return fail(`No successful get_model call read ${recovery.correction}.`);
  }
  const lost = roundsOf(
    run.toolCalls.filter((call) => call.failed),
    misspelled,
  );
  if (lost.length === 0) {
    return pass(
      `${recovery.correction} was read, with no failed lookup of ${recovery.misspelled}.`,
    );
  }
  return Math.max(...reads) > Math.min(...lost)
    ? pass(
        `${recovery.correction} was read after the failed lookup of ${recovery.misspelled}.`,
      )
    : fail(
        `${recovery.correction} was not read after the failed lookup of ${recovery.misspelled}.`,
      );
};

/** invented-data: the model the question asks about is not in the snapshot, and the answer states a price for it. */
export const noPriceForUnknown: Check = (output, context) => {
  const run = answered(output);
  if (!run) return pass('Left to an earlier class.');
  const { unknownModel } = readCase(context);
  if (unknownModel === undefined) return pass('No unknown model declared.');
  const held = currentSnapshot().models.some(
    (model) => model.id.toLowerCase() === unknownModel.toLowerCase(),
  );
  if (held) {
    throw new CaseError(
      `The snapshot holds ${unknownModel}, so the case cannot ask about a model that it lacks.`,
    );
  }
  return statesPrice(run.answer)
    ? fail(
        `The answer states a price for ${unknownModel}, which the snapshot lacks.`,
      )
    : pass(`The answer states no price for ${unknownModel}.`);
};
