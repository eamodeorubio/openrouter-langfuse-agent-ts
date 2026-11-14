import { CaseError } from './caseSpec.js';
import { statesPrice } from './figures.js';
import { type ModelRecord, modelRecord } from './outputs.js';
import { questionModels } from './questionModels.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

/** Phrases that say that a model has no fixed price, matched in any case. A price word stands near "vary" and its kin, so that "it routes requests quickly" does not pass. */
const PRICE = '(?:price|pricing|cost|rate)';
const KIND = '(?:fixed|single|set|listed|published|specific|flat|standard)';
const VARIES = '(?:vary|varies|varying|variable|dynamic|depends?)';
const NO_FIXED_PRICE = [
  new RegExp(`(?:\\bno|\\bnot|n't) (?:an? )?${KIND} ${PRICE}`),
  new RegExp(`\\b${PRICE}s? (?:is|are) (?:not|n't) ${KIND}`),
  new RegExp(`\\bdoes(?: not|n't) have an? (?:\\w+ )?${PRICE}`),
  new RegExp(`\\b${PRICE}s?\\b[^.]{0,40}\\b${VARIES}\\b`),
  new RegExp(`\\b${VARIES}\\b[^.]{0,40}\\b${PRICE}`),
  /\bdepends? on (?:the )?model/,
  /\brout(?:es|ed|ing) (?:\w+ ){0,4}to\b/,
];

/**
 * The models a question names, each with what the tools returned for it, or the ones that no output holds.
 * A question that names no model of the snapshot is a fault of the case, or of a catalog that dropped the model: it throws, so that no check passes without judging.
 */
export const readModels = (
  question: string,
  calls: Parameters<typeof modelRecord>[0],
): { read: [string, ModelRecord][]; unread: string[] } => {
  const slugs = questionModels(question);
  if (slugs.length === 0) {
    throw new CaseError(
      `The question of the case names no model of the snapshot, so its checks cannot judge a run: ${JSON.stringify(question)}.`,
    );
  }
  const read: [string, ModelRecord][] = [];
  const unread: string[] = [];
  for (const slug of slugs) {
    const record = modelRecord(calls, slug);
    if (record) read.push([slug, record]);
    else unread.push(slug);
  }
  return { read, unread };
};

/** wrong-search: a model the question names was never read by a successful call. */
export const modelsRead: Check = (output) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { unread } = readModels(run.question, run.toolCalls);
  return unread.length === 0
    ? pass('A tool output holds every model of the question.')
    : fail(`No tool output holds ${unread.join(', ')}.`);
};

export const hasNoPrice = (record: ModelRecord): boolean =>
  typeof record.promptPrice !== 'number' &&
  typeof record.completionPrice !== 'number';

/** invented-data: a model the tools returned no price for, and the answer states one. */
export const noPriceStated: Check = (output) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { read, unread } = readModels(run.question, run.toolCalls);
  if (unread.length > 0) return pass('Left to wrong-search.');
  const without = read.filter(([, record]) => hasNoPrice(record));
  if (without.length === 0) {
    return pass('The tools returned a price, so the case does not apply.');
  }
  const [slug] = without[0] as [string, ModelRecord];
  return statesPrice(run.answer)
    ? fail(
        `The tools returned no price for ${slug}, and the answer states one.`,
      )
    : pass('The answer states no price for a model that has none.');
};

/** wrong-value: a model with no price, and the answer does not say that it has no fixed price. */
export const saysNoFixedPrice: Check = (output) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { read, unread } = readModels(run.question, run.toolCalls);
  if (unread.length > 0) return pass('Left to wrong-search.');
  const without = read.filter(([, record]) => hasNoPrice(record));
  if (without.length === 0) return pass('The case does not apply.');
  const [slug] = without[0] as [string, ModelRecord];
  const answer = run.answer.toLowerCase();
  return NO_FIXED_PRICE.some((phrase) => phrase.test(answer))
    ? pass('The answer says that the model has no fixed price.')
    : fail(
        `The tools returned no price for ${slug}, and the answer does not say that it has none.`,
      );
};
