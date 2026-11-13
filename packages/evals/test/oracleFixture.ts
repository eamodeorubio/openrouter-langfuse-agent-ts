import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CatalogModel, Snapshot } from '../src/oracle/snapshot.js';
import { writeSnapshot } from '../src/oracle/snapshot.js';

export const catalogModel = (
  id: string,
  contextLength: number | null,
  tools: boolean,
  inputPrice: number | null,
  outputPrice: number | null,
  modalities: { input?: string[]; output?: string[] } = {},
): CatalogModel => ({
  id,
  contextLength,
  supportedParameters: tools ? ['tools', 'seed'] : ['seed'],
  inputModalities: modalities.input ?? ['text'],
  outputModalities: modalities.output ?? ['text'],
  inputPrice,
  outputPrice,
});

/** The table of the oracle spec: with 200000 tokens, tools and a mix of 3, `t/g` and `t/h` tie as cheapest. */
export const TABLE: CatalogModel[] = [
  catalogModel('t/a', 262144, true, 1.0, 4.0),
  catalogModel('t/b', 200000, true, 2.0, 0.4),
  catalogModel('t/c', 128000, true, 0.1, 0.1),
  catalogModel('t/d', 300000, true, 0, 0),
  catalogModel('t/e', 300000, false, 0.01, 0.01),
  catalogModel('t/f', 300000, true, null, null),
  catalogModel('t/g', 200000, true, 1.0, 2.4),
  catalogModel('t/h', 250000, true, 0.9, 2.7),
];

/** Writes a snapshot of `models` to a new file and returns its path. */
export const snapshotFile = (models: CatalogModel[] = TABLE): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-fixture-'));
  const snapshot: Snapshot = { fetchedAt: '2026-11-13T22:00:00.000Z', models };
  return writeSnapshot(dir, snapshot);
};
