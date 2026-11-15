import { readCase } from './caseSpec.js';
import { matchesCount, matchesPrice } from './figures.js';
import { type ModelRecord, modelRecord } from './outputs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

/** wrong-search: the case asks about a model and no successful call returned it. */
export const askedModelFound: Check = (output, context) => {
  const run = judgeable(output);
  const { askedModel: asked } = readCase(context);
  if (!run || asked === undefined) return pass('Nothing to find.');
  return modelRecord(run.toolCalls, asked)
    ? pass(`A tool output holds ${asked}.`)
    : fail(`No tool output holds ${asked}.`);
};

const FIGURES = {
  inputPrice: (record: ModelRecord, answer: string) =>
    record.promptPrice === undefined ||
    record.promptPrice === null ||
    matchesPrice(answer, record.promptPrice),
  outputPrice: (record: ModelRecord, answer: string) =>
    record.completionPrice === undefined ||
    record.completionPrice === null ||
    matchesPrice(answer, record.completionPrice),
  contextLength: (record: ModelRecord, answer: string) =>
    record.contextLength === undefined ||
    matchesCount(answer, record.contextLength),
} as const;

/** wrong-value: the answer lacks a figure the tool output holds for the asked model. */
export const askedFigures: Check = (output, context) => {
  const run = judgeable(output);
  const { askedModel, askedFigures: names } = readCase(context);
  if (!run || askedModel === undefined || names === undefined) {
    return pass('Nothing to compare.');
  }
  const record = modelRecord(run.toolCalls, askedModel);
  if (!record) return pass('Left to wrong-search.');
  const missing = names.filter((name) => !FIGURES[name](record, run.answer));
  return missing.length === 0
    ? pass('The answer holds every asked figure.')
    : fail(
        `The answer lacks the figure the tool returned: ${missing.join(', ')}.`,
      );
};
