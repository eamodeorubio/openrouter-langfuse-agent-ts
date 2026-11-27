import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  loadSnapshot,
  SnapshotError,
  toModels,
  writeSnapshot,
} from '../src/oracle/snapshot.js';
import { catalogModel } from './oracleFixture.js';

const scoresOf = (benchmarks: unknown) =>
  toModels({ data: [{ id: 'a/b', benchmarks }] })[0]?.scores;

describe('the benchmark scores of the API list', () => {
  it('are kept under the name the API gives each, without the ones that are null', () => {
    expect(
      scoresOf({
        artificial_analysis: {
          legal_index: 41.2,
          cyber_index: null,
          openness_index: 0,
        },
      }),
    ).toStrictEqual({ legal_index: 41.2, openness_index: 0 });
  });

  it.each([
    ['no benchmarks', undefined],
    ['benchmarks that are no object', 'high'],
    ['no Artificial Analysis entry', { design_arena: [] }],
    ['an entry that is no object', { artificial_analysis: [1] }],
    ['no number', { artificial_analysis: { legal_index: '41' } }],
  ])('are left out of a model with %s', (_, benchmarks) => {
    expect(
      toModels({ data: [{ id: 'a/b', benchmarks }] })[0],
    ).not.toHaveProperty('scores');
  });

  it('are exactly the finite numbers of the entry, whatever else the API sends', () => {
    const value = fc.oneof(fc.double(), fc.integer(), fc.anything());
    fc.assert(
      fc.property(fc.dictionary(fc.string(), value), (entry) => {
        const finite = Object.entries(entry).filter(([, score]) =>
          Number.isFinite(score),
        );
        expect(scoresOf({ artificial_analysis: entry })).toStrictEqual(
          finite.length > 0 ? Object.fromEntries(finite) : undefined,
        );
      }),
    );
  });

  it('are read without a throw from any benchmarks at all', () => {
    fc.assert(
      fc.property(fc.anything(), (benchmarks) => {
        expect(() => scoresOf(benchmarks)).not.toThrow();
      }),
    );
  });
});

describe('a saved snapshot and its scores', () => {
  const dirs: string[] = [];
  const save = (model: object) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-scores-'));
    dirs.push(dir);
    return writeSnapshot(dir, {
      fetchedAt: '2026-11-27T00:00:00.000Z',
      models: [model as ReturnType<typeof catalogModel>],
    });
  };
  const model = catalogModel('a/b', 1, true, 1, 1);

  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads with the scores it was saved with', () => {
    const scored = { ...model, scores: { legal_index: 41.2 } };
    expect(loadSnapshot(save(scored)).models).toStrictEqual([scored]);
  });

  it('loads without scores, as one saved before they were kept', () => {
    expect(loadSnapshot(save(model)).models).toStrictEqual([model]);
  });

  it.each([
    [null],
    ['high'],
    [[41]],
    [{ legal_index: 'high' }],
    [{ legal_index: null }],
    [{ legal_index: 41, cyber_index: 'high' }],
  ])('is refused when its scores are %j', (scores) => {
    expect(() => loadSnapshot(save({ ...model, scores }))).toThrow(
      SnapshotError,
    );
  });
});
