import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(
  path.resolve(root, '../../docs/src/content/docs/evals.md'),
  'utf8',
);

interface Case {
  metadata: { id: string; needsLookup?: boolean };
  assert?: { metric: string }[];
}

const cases: Case[] = fs
  .readdirSync(path.join(root, 'cases'))
  .filter((file) => file.endsWith('.yaml'))
  .flatMap(
    (file) =>
      parse(fs.readFileSync(path.join(root, 'cases', file), 'utf8')) as Case[],
  );

/** Every case, for the class that judges all of them. */
const EVERY_CASE = 'every case';

/** The classes of the universal checks of the config, and the cases they judge. */
const universal = (test: Case): string[] => [
  'run-failed',
  ...(test.metadata.needsLookup ? ['memory-answer', 'invented-data'] : []),
];

/** The cases that provoke each class: by their own checks, and by the universal ones. */
const provokers = (): Map<string, Set<string>> => {
  const byClass = new Map<string, Set<string>>();
  for (const test of cases) {
    const classes = [
      ...universal(test),
      ...(test.assert ?? []).map((check) => check.metric),
    ];
    for (const name of classes) {
      byClass.set(name, (byClass.get(name) ?? new Set()).add(test.metadata.id));
    }
  }
  return byClass;
};

/** The rows of the taxonomy table of the page: the code, and what its last column names. */
const rows = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const line of page.split('\n')) {
    const code = /^\| `([a-z-]+)`\s+\|/.exec(line)?.[1];
    if (code) found.set(code, line.split('|').slice(-2)[0]?.trim() ?? '');
  }
  return found;
};

describe('the tables of the docs page', () => {
  it('have as many cells in every row as in their header', () => {
    let width = 0;
    let inTable = false;
    for (const line of page.split('\n')) {
      if (!line.startsWith('|')) {
        inTable = false;
        continue;
      }
      const cells = line.split('|').length - 2;
      if (!inTable) {
        width = cells;
        inTable = true;
      }
      expect(cells, line.slice(0, 60)).toBe(width);
    }
  });

  it('name each case once in the table of the cases, by its code', () => {
    const start = page.indexOf('## The cases');
    const cell = (id: string) =>
      page
        .slice(start)
        .split('\n')
        .filter((line) => line.startsWith(`| \`${id}\``));
    for (const test of cases)
      expect(cell(test.metadata.id), test.metadata.id).toHaveLength(1);
  });
});

describe('the taxonomy table of the docs page', () => {
  it('has a row for every class the cases can provoke, and for no other', () => {
    expect([...rows().keys()].sort()).toEqual([...provokers().keys()].sort());
  });

  it('names, for every class, the cases that provoke it', () => {
    for (const [name, ids] of provokers()) {
      const cell = rows().get(name) ?? '';
      if (name === 'run-failed') {
        expect(cell, name).toBe(EVERY_CASE);
        continue;
      }
      const named = [...cell.matchAll(/`([a-z]+\/[a-z0-9-]+)`/g)].map(
        (match) => match[1],
      );
      expect(named.sort(), name).toEqual([...ids].sort());
    }
  });

  it('lists every case in the table of the cases', () => {
    for (const test of cases) {
      expect(page, test.metadata.id).toContain(`\`${test.metadata.id}\``);
    }
  });
});
