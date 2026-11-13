/**
 * The checks promptfoo calls, one per error class: `file://src/checks/assertions.ts:<name>`.
 * Each takes the run's output and the test case, and returns a verdict.
 * A check later in the chain passes without judging when an earlier class
 * already fired: run-failed, then memory-answer, then wrong-search, then
 * wrong-answer, then invented-data and wrong-value.
 */
import { matchesCount, matchesPrice } from './figures.js';
import { type ModelRecord, modelIds, modelRecord } from './outputs.js';
import {
  asSuccess,
  isBlank,
  lookupMade,
  type Success,
  successfulCalls,
} from './run.js';
import { authorsOf, isGrounded, namedModels, slugTokens } from './slugs.js';

export interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

/** What promptfoo hands a check besides the output. The case declares its needs in `metadata`. */
export interface CheckContext {
  test?: { metadata?: Record<string, unknown> };
}

/** The shape promptfoo calls: the output, then the test case. */
type Check = (output: unknown, context?: unknown) => GradingResult;

const verdict = (pass: boolean, reason: string): GradingResult => ({
  pass,
  score: pass ? 1 : 0,
  reason,
});

const pass = (reason: string): GradingResult => verdict(true, reason);
const fail = (reason: string): GradingResult => verdict(false, reason);

const metadataOf = (context: unknown): Record<string, unknown> => {
  const test = (context as CheckContext | null | undefined)?.test;
  return test?.metadata ?? {};
};

/** The run the later checks judge: a success object with an answer and a lookup. */
const judgeable = (output: unknown): Success | undefined => {
  const run = asSuccess(output);
  return run && !isBlank(run) && lookupMade(run) ? run : undefined;
};

/** run-failed: the run has no answer. A provider error never reaches a check. */
export const runFailed: Check = (output) => {
  const run = asSuccess(output);
  if (!run) return fail('The output is not a success object of the CLI.');
  return isBlank(run)
    ? fail('The answer is empty.')
    : pass('The run has an answer.');
};

/** memory-answer: the case needs a lookup and no tool call succeeded. */
export const memoryAnswer: Check = (output, context) => {
  const run = asSuccess(output);
  if (!run || isBlank(run)) return pass('Left to run-failed.');
  if (metadataOf(context).needsLookup !== true) {
    return pass('The case needs no lookup.');
  }
  return lookupMade(run)
    ? pass('A tool call succeeded.')
    : fail('The case needs a lookup and no tool call succeeded.');
};

/**
 * invented-data: the answer names a model that neither the question nor a tool
 * output holds. A name counts when its author owns a model the tools returned or
 * the question named, or when it sits in backticks. Slashes in prose, such as
 * `text/plain`, make no author. The oracle snapshot will widen that to every
 * known author.
 */
export const inventedModels: Check = (output) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const sources = new Set(
    slugTokens(
      [run.question, ...successfulCalls(run).map((call) => call.output)].join(
        '\n',
      ),
    ),
  );
  const known = authorsOf([
    ...slugTokens(run.question),
    ...modelIds(run.toolCalls),
  ]);
  const invented = namedModels(run.answer, known).filter(
    (slug) => !isGrounded(slug, sources),
  );
  return invented.length === 0
    ? pass(
        'Every model the answer names is in the question or in a tool output.',
      )
    : fail(`No source holds: ${invented.join(', ')}.`);
};

/** wrong-search: the case asks about a model and no successful call returned it. */
export const askedModelFound: Check = (output, context) => {
  const run = judgeable(output);
  const asked = metadataOf(context).askedModel;
  if (!run || typeof asked !== 'string') return pass('Nothing to find.');
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
  const { askedModel, askedFigures: names } = metadataOf(context);
  if (!run || typeof askedModel !== 'string' || !Array.isArray(names)) {
    return pass('Nothing to compare.');
  }
  const record = modelRecord(run.toolCalls, askedModel);
  if (!record) return pass('Left to wrong-search.');
  const missing = names.filter(
    (name): name is keyof typeof FIGURES =>
      name in FIGURES &&
      !FIGURES[name as keyof typeof FIGURES](record, run.answer),
  );
  return missing.length === 0
    ? pass('The answer holds every asked figure.')
    : fail(
        `The answer lacks the figure the tool returned: ${missing.join(', ')}.`,
      );
};
