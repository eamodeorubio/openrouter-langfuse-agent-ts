import { optionalSnapshot } from '../oracle/catalog.js';
import { readCase } from './caseSpec.js';
import { modelIds } from './outputs.js';
import { asSuccess, isBlank, lookupMade, successfulCalls } from './run.js';
import { authorsOf, isGrounded, namedModels, slugTokens } from './slugs.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

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
  if (readCase(context).needsLookup !== true) {
    return pass('The case needs no lookup.');
  }
  return lookupMade(run)
    ? pass('A tool call succeeded.')
    : fail('The case needs a lookup and no tool call succeeded.');
};

/**
 * invented-data: the answer names a model that neither the question nor a tool
 * output holds. A name counts when its author owns a model of the snapshot, a
 * model the tools returned or a model the question named, or when it sits in
 * backticks. Slashes in prose, such as `text/plain`, make no author.
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
    // Stryker disable next-line ArrayDeclaration: equivalent because a name without a slash is no author
    ...(optionalSnapshot()?.models.map((model) => model.id) ?? []),
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
