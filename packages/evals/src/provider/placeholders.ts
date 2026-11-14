import { flagshipModel, freeModel, PickError } from '../oracle/picks.js';
import type { Snapshot } from '../oracle/snapshot.js';

/** The placeholders a question may hold, each with the pick that fills it. */
const PLACEHOLDERS: Record<
  string,
  (snapshot: Snapshot, underTest: readonly string[]) => string
> = {
  '{flagship_model}': (snapshot) => flagshipModel(snapshot.models),
  '{free_model}': (snapshot, underTest) =>
    freeModel(snapshot.models, underTest),
};

/**
 * Fills the placeholders of a prompt from the snapshot of the run. A pick is
 * made only for a placeholder the prompt holds, and any other `{name}` stays.
 */
export const resolvePlaceholders = (
  prompt: string,
  snapshot: Snapshot | undefined,
  underTest: readonly string[],
): string => {
  let resolved = prompt;
  for (const [placeholder, pick] of Object.entries(PLACEHOLDERS)) {
    if (!resolved.includes(placeholder)) continue;
    if (!snapshot) {
      throw new PickError(
        `The prompt holds the placeholder ${placeholder}, and the run has no snapshot: EVAL_CATALOG names none.`,
      );
    }
    const slug = pick(snapshot, underTest);
    resolved = resolved.replaceAll(placeholder, () => slug);
  }
  return resolved;
};
