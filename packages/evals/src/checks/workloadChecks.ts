import { workloadCost as monthlyCost } from '../oracle/workload.js';
import { readCase } from './caseSpec.js';
import { matchesCost, matchesRatio } from './figures.js';
import { readModels } from './modelPrices.js';
import { type Check, fail, judgeable, pass } from './verdict.js';

const money = (value: number): string => value.toFixed(2);

/** wrong-value: the answer lacks the monthly cost of a model, or the ratio of two costs. */
export const workloadCost: Check = (output, context) => {
  const run = judgeable(output);
  if (!run) return pass('Left to an earlier class.');
  const { workload } = readCase(context);
  if (!workload) return pass('No workload.');
  const { read, unread } = readModels(run.question, run.toolCalls);
  const costs: [string, number][] = [];
  for (const [slug, record] of read) {
    const { promptPrice, completionPrice } = record;
    if (
      typeof promptPrice !== 'number' ||
      typeof completionPrice !== 'number'
    ) {
      return pass(
        `The tools returned no price for ${slug}: left to invented-data and wrong-value.`,
      );
    }
    costs.push([slug, monthlyCost(workload, promptPrice, completionPrice)]);
  }
  if (unread.length > 0) return pass('Left to wrong-search.');

  const missing = costs.filter(([, cost]) => !matchesCost(run.answer, cost));
  if (missing.length > 0) {
    return fail(
      missing
        .map(
          ([slug, cost]) =>
            `The answer states no amount within 1% of the monthly cost of ${slug}: ${money(cost)}.`,
        )
        .join(' '),
    );
  }
  if (costs.length === 2) {
    const [dear, cheap] = [...costs].sort((a, b) => b[1] - a[1]) as [
      [string, number],
      [string, number],
    ];
    if (cheap[1] > 0) {
      const ratio = dear[1] / cheap[1];
      if (
        !matchesRatio(run.answer, ratio) &&
        !matchesRatio(run.answer, 1 / ratio)
      ) {
        return fail(
          `The answer states no ratio within 1% of ${money(ratio)} or ${money(1 / ratio)} between the costs of ${dear[0]} and ${cheap[0]}.`,
        );
      }
    }
  }
  return pass(
    `The answer states the monthly cost of every model: ${costs.map(([, cost]) => money(cost)).join(', ')}.`,
  );
};
