import type { CatalogModel } from './snapshot.js';

/** The snapshot holds no model for a pick. The run says so and stops. */
export class PickError extends Error {}

/** The sum of the prices of a model, or null when it lacks one. */
const priceSum = (model: CatalogModel): number | null =>
  model.inputPrice === null || model.outputPrice === null
    ? null
    : model.inputPrice + model.outputPrice;

/** The paid model with the highest sum of input and output prices, the lowest slug on a tie. */
export const flagshipModel = (models: readonly CatalogModel[]): string => {
  const paid = models.flatMap((model) => {
    const sum = priceSum(model) ?? 0;
    return sum > 0 ? [{ id: model.id, sum }] : [];
  });
  if (paid.length === 0) {
    throw new PickError('The snapshot holds no paid model to be the flagship.');
  }
  const top = Math.max(...paid.map((entry) => entry.sum));
  // The default sort orders by code unit, so no comparator can disagree with itself.
  const [best] = paid
    .filter((entry) => entry.sum === top)
    .map((entry) => entry.id)
    .sort();
  return best as string;
};

/** The first free slug, in ascending order, that is not a model under test. A model is free when both prices are 0. */
export const freeModel = (
  models: readonly CatalogModel[],
  underTest: readonly string[],
): string => {
  const excluded = new Set(underTest.map((id) => id.toLowerCase()));
  const [first] = models
    .filter(
      (model) =>
        model.inputPrice === 0 &&
        model.outputPrice === 0 &&
        !excluded.has(model.id.toLowerCase()),
    )
    .map((model) => model.id)
    .sort();
  if (first === undefined) {
    throw new PickError(
      `The snapshot holds no free model besides the models under test (${underTest.join(', ')}).`,
    );
  }
  return first;
};
