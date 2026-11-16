import { isObject, parseJson } from '../json.js';
import { currentSnapshot } from '../oracle/catalog.js';
import { escapeRegExp } from '../regexp.js';
import { CaseError, readCase } from './caseSpec.js';
import { statesPrice } from './figures.js';
import { readModels } from './modelPrices.js';
import type { ToolCall } from './run.js';
import { successfulCalls } from './run.js';
import { authorsOf, beforeNextModel } from './slugs.js';
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

/** no-recovery: the lookup of a misspelled model failed, and no read of the model it meant came in the round of the failure or later. */
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
  // The model may send both lookups in one round, so a read in that round counts.
  return Math.max(...reads) >= Math.min(...lost)
    ? pass(
        `${recovery.correction} was read after the failed lookup of ${recovery.misspelled}.`,
      )
    : fail(
        `${recovery.correction} was not read after the failed lookup of ${recovery.misspelled}.`,
      );
};

// A full stop ends a sentence, but not after an abbreviation: "approx. $2" holds a price.
const SENTENCE_END = /\n|(?<!\b(?:e\.g|i\.e|approx|vs|etc|ca))[.!?](?=\s|$)/;

/** The text that follows each mention of a slug, up to the next model: its price may come in a later sentence. */
const followingText = (
  answer: string,
  slug: string,
  authors: ReadonlySet<string>,
): string[] =>
  [
    ...answer.matchAll(
      new RegExp(`(?<![\\w/-])${escapeRegExp(slug)}(?![\\w-])`, 'gi'),
    ),
  ].map((mention) =>
    beforeNextModel(answer.slice(mention.index + mention[0].length), authors),
  );

/** invented-data: the model the question asks about is not in the snapshot, and the answer states a price for it, after its slug. */
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
  const authors = authorsOf([
    unknownModel.toLowerCase(),
    ...currentSnapshot().models.map((model) => model.id.toLowerCase()),
  ]);
  const mentions = followingText(run.answer, unknownModel, authors);
  // An answer that never names the model speaks of it as "it": a price counts
  // when no other model comes before it in its sentence.
  const claims =
    mentions.length > 0
      ? mentions
      : run.answer
          .split(SENTENCE_END)
          .map((sentence) => beforeNextModel(sentence, authors));
  return claims.some(statesPrice)
    ? fail(
        `The answer states a price for ${unknownModel}, which the snapshot lacks.`,
      )
    : pass(`The answer states no price for ${unknownModel}.`);
};
