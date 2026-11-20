import * as assertions from '../checks/assertions.js';
import type { Check } from '../checks/verdict.js';

const PREFIX = 'file://src/checks/assertions.ts:';

/**
 * The check that an assertion value names, or `undefined` when it names none.
 * Only `file://src/checks/assertions.ts:<export>` is read: the command runs
 * what it can name, and no other code. A module namespace has no prototype,
 * so a name such as `toString` finds nothing, and the file exports only
 * functions apart from types.
 */
export const resolveCheck = (value: unknown): Check | undefined =>
  typeof value === 'string' && value.startsWith(PREFIX)
    ? (assertions as Record<string, Check | undefined>)[
        value.slice(PREFIX.length)
      ]
    : undefined;
