import { currentSnapshot } from '../oracle/catalog.js';
import { runQuery } from '../oracle/queries.js';
import type { Oracle } from './caseSpec.js';

/** The slugs, in lower case, that the oracle query of a case accepts on the snapshot of the run. */
export const acceptableSlugs = (oracle: Oracle): string[] =>
  runQuery(oracle.query, currentSnapshot().models, oracle.params).map((slug) =>
    slug.toLowerCase(),
  );
