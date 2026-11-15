import { fakeKey } from '../oracle/fakeKey.js';
import { flagshipModel, freeModel, PickError } from '../oracle/picks.js';
import type { Snapshot } from '../oracle/snapshot.js';

/** What a placeholder may need to be filled: the snapshot of the run, and the models under test. */
interface Source {
  /** The snapshot of the run. Throws when the run has none. */
  snapshot: () => Snapshot;
  underTest: readonly string[];
}

/** The placeholders a question may hold, each with the pick that fills it. */
const PLACEHOLDERS: Record<string, (source: Source) => string> = {
  '{flagship_model}': ({ snapshot }) => flagshipModel(snapshot().models),
  '{free_model}': ({ snapshot, underTest }) =>
    freeModel(snapshot().models, underTest),
  '{fake_key}': () => fakeKey(),
};

/**
 * Fills the placeholders of a prompt. A pick is made only for a placeholder
 * the prompt holds, once for all its occurrences, and any other `{name}` stays.
 */
export const resolvePlaceholders = (
  prompt: string,
  snapshot: Snapshot | undefined,
  underTest: readonly string[],
): string => {
  let resolved = prompt;
  for (const [placeholder, pick] of Object.entries(PLACEHOLDERS)) {
    if (!resolved.includes(placeholder)) continue;
    const value = pick({
      snapshot: () => {
        if (!snapshot) {
          throw new PickError(
            `The prompt holds the placeholder ${placeholder}, and the run has no snapshot: EVAL_CATALOG names none.`,
          );
        }
        return snapshot;
      },
      underTest,
    });
    resolved = resolved.replaceAll(placeholder, () => value);
  }
  return resolved;
};
