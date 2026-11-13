import fs from 'node:fs';
import { loadSnapshot, type Snapshot, SnapshotError } from './snapshot.js';

/** The environment variable that tells the checks where the snapshot of the run is. */
export const CATALOG_ENV = 'EVAL_CATALOG';

const loaded = new Map<string, { stamp: string; snapshot: Snapshot }>();

/** A snapshot file is fixed for a run, so it is read once. A file that changed on disk is read again. */
const load = (file: string): Snapshot => {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  // A file that is gone has no stamp, and `loadSnapshot` says so.
  // Stryker disable next-line StringLiteral: equivalent because a file that is gone matches no stamp, and is read, and refused, either way
  const stamp = stat ? `${stat.mtimeMs}:${stat.size}` : '';
  const known = loaded.get(file);
  if (known?.stamp === stamp) return known.snapshot;
  const snapshot = loadSnapshot(file);
  loaded.set(file, { stamp, snapshot });
  return snapshot;
};

/** The snapshot of the run the checks belong to, or `undefined` when no snapshot was taken. */
export const optionalSnapshot = (): Snapshot | undefined => {
  const file = process.env[CATALOG_ENV];
  return file ? load(file) : undefined;
};

/** The snapshot of the run. Throws a `SnapshotError` when the run has none. */
export const currentSnapshot = (): Snapshot => {
  const snapshot = optionalSnapshot();
  if (!snapshot) {
    throw new SnapshotError(
      `The checks need the snapshot of the run, and ${CATALOG_ENV} does not name one.`,
    );
  }
  return snapshot;
};
