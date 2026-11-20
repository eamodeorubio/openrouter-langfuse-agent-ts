import type { Flip } from './rows.js';

/** One line for a flip: the case, the model, the repeat, the check, and its verdict before and after. */
export const formatFlip = (flip: Flip): string =>
  `${flip.caseId} | ${flip.model} | repeat ${flip.repeat} | ${flip.metric} | ${flip.before} → ${flip.after}`;

/** The closing line: how many flips, in how many rows judged. */
export const summaryLine = (flips: number, rows: number): string =>
  `${flips} ${flips === 1 ? 'flip' : 'flips'} in ${rows} ${rows === 1 ? 'row' : 'rows'}.`;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The flips by case, model and repeat. The sort is stable, so the checks of one row keep the order they ran in. The list it was given is not modified. */
export const orderFlips = (flips: Flip[]): Flip[] =>
  [...flips].sort(
    (a, b) =>
      compare(a.caseId, b.caseId) ||
      compare(a.model, b.model) ||
      a.repeat - b.repeat,
  );
