import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorsOf } from '../src/checks/slugs.js';
import {
  CATALOG_ENV,
  currentSnapshot,
  optionalSnapshot,
} from '../src/oracle/catalog.js';
import { SnapshotError, writeSnapshot } from '../src/oracle/snapshot.js';
import { catalogModel, snapshotFile } from './oracleFixture.js';

afterEach(() => vi.unstubAllEnvs());

describe('the snapshot of the run', () => {
  it('is named by EVAL_CATALOG', () => {
    expect(CATALOG_ENV).toBe('EVAL_CATALOG');
  });

  it('is nothing when the run took none, and an error when a check needs one', () => {
    vi.stubEnv(CATALOG_ENV, '');
    expect(optionalSnapshot()).toBeUndefined();
    expect(() => currentSnapshot()).toThrow(SnapshotError);
    expect(() => currentSnapshot()).toThrow(
      'The checks need the snapshot of the run, and EVAL_CATALOG does not name one.',
    );
  });

  it('is read from the file the variable names', () => {
    vi.stubEnv(CATALOG_ENV, snapshotFile([catalogModel('a/b', 1, true, 1, 1)]));
    expect(currentSnapshot().models.map((model) => model.id)).toEqual(['a/b']);
  });

  it('is read once for a file that does not change, and again when it does', () => {
    const file = snapshotFile([catalogModel('a/b', 1, true, 1, 1)]);
    vi.stubEnv(CATALOG_ENV, file);
    const first = currentSnapshot();
    expect(currentSnapshot()).toBe(first);
    expect(optionalSnapshot()).toBe(first);

    writeSnapshot(path.dirname(file), {
      fetchedAt: '2026-11-14T00:00:00.000Z',
      models: [
        catalogModel('a/b', 1, true, 1, 1),
        catalogModel('c/d', 2, false, 2, 2),
      ],
    });
    const second = currentSnapshot();
    expect(second).not.toBe(first);
    expect(second.models.map((model) => model.id)).toEqual(['a/b', 'c/d']);
  });

  it('is read again when the file changed without changing its size', () => {
    const file = snapshotFile([catalogModel('a/b', 1, true, 1, 1)]);
    vi.stubEnv(CATALOG_ENV, file);
    const first = currentSnapshot();
    const text = fs.readFileSync(file, 'utf8').replace('a/b', 'x/y');
    fs.writeFileSync(file, text);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect(currentSnapshot().models[0]?.id).toBe('x/y');
    expect(currentSnapshot()).not.toBe(first);
  });

  it('is an error that names the file when it is gone', () => {
    const file = path.join(os.tmpdir(), 'evals-gone', 'catalog.json');
    vi.stubEnv(CATALOG_ENV, file);
    expect(() => currentSnapshot()).toThrow(SnapshotError);
    expect(() => currentSnapshot()).toThrow(file);
  });
});

describe('the authors of a list of models', () => {
  it('are the part before the slash, and a name with no slash has none', () => {
    expect(authorsOf(['a/b', 'c/d:free', 'noslash', 'a/x'])).toEqual(
      new Set(['a', 'c']),
    );
    expect(authorsOf(['noslash'])).toEqual(new Set());
    expect(authorsOf([])).toEqual(new Set());
  });
});
