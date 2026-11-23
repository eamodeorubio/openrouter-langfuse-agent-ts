import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GateConfig } from '../src/gate/config.js';
import { decide } from '../src/gate/decide.js';
import { passHatK } from '../src/report/estimators.js';
import { readRuns } from '../src/report/results.js';
import { type Cell, resultsOf } from './gateFixture.js';

const config = (floors: Record<string, number>, mean = 0.85): GateConfig => ({
  model: 'm/one',
  repeat: 10,
  k: 3,
  mean,
  cases: floors,
});

const decideCells = (cells: Cell[], gate: GateConfig) =>
  decide(readRuns(resultsOf(cells)).runs, gate);

const ok = (cells: Cell[], gate: GateConfig) => {
  const result = decideCells(cells, gate);
  if (!result.ok) throw new Error(result.message);
  return result;
};

const floors = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, 0.4]));

describe('decide: floors at n 10 and k 3', () => {
  it.each([
    [10, 1.0, false],
    [8, 0.4667, false],
    [7, 0.2917, true],
    [0, 0, true],
  ])(
    'a case with %i passes has pass^3 %f, below its floor: %s',
    (c, value, below) => {
      const { rows } = ok(
        [{ caseName: 'a/one', passed: c }],
        config(floors('a/one'), 0),
      );
      expect(rows[0]?.passHat).toBeCloseTo(value, 4);
      expect(rows[0]?.below).toBe(below);
      expect(rows[0]).toMatchObject({ caseName: 'a/one', c, n: 10, errors: 0 });
    },
  );

  it('judges a case by a floor of its own', () => {
    const { rows } = ok(
      [{ caseName: 'a/three', passed: 5 }],
      config({ 'a/three': 0.05 }, 0),
    );
    expect(rows[0]?.passHat).toBeCloseTo(0.0833, 4);
    expect(rows[0]?.below).toBe(false);
  });

  it('does not breach a value equal to its floor', () => {
    const exact = passHatK(10, 8, 3);
    const { rows, verdict } = ok(
      [{ caseName: 'a/one', passed: 8 }],
      config({ 'a/one': exact }, exact),
    );
    expect(rows[0]?.below).toBe(false);
    expect(verdict).toBe('pass');
  });

  it('computes the mean of the cases with equal weight', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `a/c${i}`);
    const cells = ids.map((caseName, i) => ({
      caseName,
      passed: i === 0 ? 8 : 10,
    }));
    const result = ok(cells, config(floors(...ids), 0.95));
    expect(result.mean.value).toBeCloseTo(0.9515, 4);
    expect(result.mean.below).toBe(false);
    expect(result.verdict).toBe('pass');
  });

  it('sorts the rows by case id, whatever the order of the runs', () => {
    const ids = ['a/x', 'a/y', 'b/a', 'b/b', 'c'];
    fc.assert(
      fc.property(fc.shuffledSubarray(ids, { minLength: 2 }), (order) => {
        const { rows } = ok(
          order.map((caseName) => ({ caseName, passed: 10 })),
          config(floors(...order)),
        );
        expect(rows.map((row) => row.caseName)).toEqual([...order].sort());
      }),
    );
  });
});

describe('decide: the verdict', () => {
  const all = floors('a/one', 'a/two', 'a/three');
  const full = (...changes: Cell[]): Cell[] => [
    ...['a/one', 'a/two', 'a/three']
      .filter((id) => !changes.some((c) => c.caseName === id))
      .map((caseName) => ({ caseName, passed: 10 })),
    ...changes,
  ];

  it('passes with provider errors that breach nothing', () => {
    const result = ok(
      full({ caseName: 'a/one', passed: 9, errors: 1 }),
      config(all),
    );
    expect(result.verdict).toBe('pass');
    expect(result.errors).toBe(1);
  });

  it('fails on a breach with no errors', () => {
    const result = ok(full({ caseName: 'a/one', passed: 7 }), config(all, 0));
    expect(result.verdict).toBe('fail');
    expect(result.casesBelow).toBe(1);
  });

  it('is inconclusive when the breach clears with the errors counted as passed', () => {
    const result = ok(
      full({ caseName: 'a/one', passed: 7, errors: 2 }),
      config(all, 0),
    );
    expect(result.verdict).toBe('inconclusive');
    expect(result.errors).toBe(2);
  });

  it('fails when another case breaches with no errors', () => {
    const result = ok(
      full(
        { caseName: 'a/one', passed: 7, errors: 2 },
        { caseName: 'a/two', passed: 7 },
      ),
      config(all, 0),
    );
    expect(result.verdict).toBe('fail');
  });

  it('is inconclusive when every run is a provider error', () => {
    const result = ok(
      ['a/one', 'a/two', 'a/three'].map((caseName) => ({
        caseName,
        passed: 0,
        errors: 10,
      })),
      config(all),
    );
    expect(result.verdict).toBe('inconclusive');
    expect(result.errors).toBe(30);
  });

  it('breaches on the mean alone when no case does', () => {
    const cells = ['a/one', 'a/two', 'a/three'].map((caseName) => ({
      caseName,
      passed: 8,
    }));
    const result = ok(cells, config(all, 0.85));
    expect(result.casesBelow).toBe(0);
    expect(result.mean.below).toBe(true);
    expect(result.verdict).toBe('fail');
  });

  it('is inconclusive when only the mean breaches and errors clear it', () => {
    const cells = ['a/one', 'a/two', 'a/three'].map((caseName) => ({
      caseName,
      passed: 8,
      errors: 2,
    }));
    expect(ok(cells, config(all, 0.85)).verdict).toBe('inconclusive');
  });
});

describe('decide: mismatches', () => {
  const good: Cell[] = [{ caseName: 'a/one', passed: 10 }];
  const message = (cells: Cell[], gate: GateConfig) => {
    const result = decideCells(cells, gate);
    if (result.ok) throw new Error('expected a mismatch');
    return result.message;
  };

  it('refuses a model other than the gate model, naming both', () => {
    const text = message(
      [{ caseName: 'a/one', passed: 10, model: 'nvidia/x:free' }],
      config(floors('a/one')),
    );
    expect(text).toContain('nvidia/x:free');
    expect(text).toContain('m/one');
  });

  it('refuses a cell whose n differs from repeat, naming case, 9 and 10', () => {
    const text = message(
      [{ caseName: 'lookup/known-model', passed: 9, failed: 0 }],
      config(floors('lookup/known-model')),
    );
    expect(text).toContain('lookup/known-model');
    expect(text).toContain('9');
    expect(text).toContain('10');
  });

  it('refuses a results file with no run, and says so', () => {
    expect(message([], config(floors('a/one')))).toBe(
      'The results hold no run.',
    );
  });

  it('refuses a floor for a case that has no run, naming it', () => {
    expect(message(good, config(floors('a/one', 'search/gone')))).toContain(
      'search/gone',
    );
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'refuses a case called %s that has no floor of its own',
    (caseName) => {
      expect(
        message([...good, { caseName, passed: 0 }], config(floors('a/one'))),
      ).toContain(caseName);
    },
  );

  it('refuses a case with no floor, naming it', () => {
    expect(
      message(
        [...good, { caseName: 'lookup/new-case', passed: 10 }],
        config(floors('a/one')),
      ),
    ).toContain('lookup/new-case');
  });
});

describe('decide: invariants', () => {
  const caseIds = ['a/one', 'a/two', 'a/three'];
  const gate = config(floors(...caseIds), 0.85);

  /** For each case, passes, errors and failures that add up to 10. */
  const cells = fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 }))
      .map(([a, b]) => {
        const passed = Math.min(a, b);
        const errors = Math.max(a, b) - passed;
        return { passed, errors, failed: 10 - passed - errors };
      }),
    { minLength: 3, maxLength: 3 },
  );
  const build = (rows: { passed: number; errors: number; failed: number }[]) =>
    rows.map((row, i) => ({ caseName: caseIds[i] as string, ...row }));
  const verdictOf = (rows: Parameters<typeof build>[0]) =>
    ok(build(rows), gate).verdict;

  it('never turns pass into fail or inconclusive when a failed run is changed to passed', () => {
    fc.assert(
      fc.property(cells, fc.nat(2), (rows, which) => {
        const row = rows[which] as (typeof rows)[number];
        fc.pre(row.failed > 0);
        if (verdictOf(rows) !== 'pass') return;
        const better = rows.map((r, i) =>
          i === which
            ? { ...r, passed: r.passed + 1, failed: r.failed - 1 }
            : r,
        );
        expect(verdictOf(better)).toBe('pass');
      }),
    );
  });

  it('never turns fail into pass or inconclusive when a passed run is changed to failed', () => {
    fc.assert(
      fc.property(cells, fc.nat(2), (rows, which) => {
        const row = rows[which] as (typeof rows)[number];
        fc.pre(row.passed > 0);
        if (verdictOf(rows) !== 'fail') return;
        const worse = rows.map((r, i) =>
          i === which
            ? { ...r, passed: r.passed - 1, failed: r.failed + 1 }
            : r,
        );
        expect(verdictOf(worse)).toBe('fail');
      }),
    );
  });

  it('never fails a run that has no failed check, whatever its provider errors', () => {
    fc.assert(
      fc.property(cells, (rows) => {
        const clean = rows.map((r) => ({
          passed: r.passed + r.failed,
          errors: r.errors,
          failed: 0,
        }));
        expect(verdictOf(clean)).not.toBe('fail');
      }),
    );
  });
});
