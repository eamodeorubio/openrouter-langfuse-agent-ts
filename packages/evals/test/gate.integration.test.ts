import { describe, expect, it } from 'vitest';
import {
  type Cell,
  GATE_YAML,
  resultsOf,
  tempDir,
  writeIn,
} from './gateFixture.js';
import { runTsx } from './runTsx.js';

const gate = (args: string[]) => runTsx(['src/gate/main.ts', ...args], {});

/** Judges cells against the fixture gate file, through the real entry. */
const judge = async (cells: Cell[], yaml = GATE_YAML) => {
  const dir = tempDir();
  const results = writeIn(
    dir,
    'results.json',
    JSON.stringify(resultsOf(cells)),
  );
  const config = writeIn(dir, 'gate.yaml', yaml);
  const done = await gate([results, '--config', config]);
  return { ...done, last: done.stdout.trimEnd().split('\n').at(-1) };
};

/** The fixture gate file with a mean floor that no cell of these tests reaches. */
const LOW_MEAN = GATE_YAML.replace('mean: 0.85', 'mean: 0.1');

const good: Cell[] = [
  { caseName: 'a/one', passed: 10 },
  { caseName: 'a/two', passed: 10 },
  { caseName: 'a/three', passed: 10 },
];
const changed = (...changes: Cell[]) => [
  ...good.filter((cell) => !changes.some((c) => c.caseName === cell.caseName)),
  ...changes,
];

describe('the gate command, end to end', () => {
  it('passes when nothing breaches, with a provider error in a case', async () => {
    const done = await judge(
      changed({ caseName: 'a/one', passed: 9, errors: 1 }),
    );
    expect(done.last).toBe('verdict: pass');
    expect(done.status).toBe(0);
  });

  it('fails when one case is below its floor with no errors', async () => {
    const done = await judge(
      changed({ caseName: 'a/one', passed: 7 }),
      LOW_MEAN,
    );
    expect(done.last).toBe('verdict: fail (1 case below its floor)');
    expect(done.status).toBe(1);
    expect(done.stdout).toContain('c=7/10');
  });

  it('is inconclusive when the breach clears with the errors counted as passed', async () => {
    const done = await judge(
      changed({ caseName: 'a/one', passed: 7, errors: 2 }),
    );
    expect(done.last).toBe(
      'verdict: inconclusive (2 provider errors; the breaches clear when they count as passed, run the gate again)',
    );
    expect(done.status).toBe(4);
  });

  it('fails when a second case breaches without errors', async () => {
    const done = await judge(
      changed(
        { caseName: 'a/one', passed: 7, errors: 2 },
        { caseName: 'a/two', passed: 7 },
      ),
      LOW_MEAN,
    );
    expect(done.last).toBe('verdict: fail (2 cases below their floor)');
    expect(done.status).toBe(1);
  });

  it('is inconclusive when every run is a provider error', async () => {
    const done = await judge(
      good.map((cell) => ({ caseName: cell.caseName, passed: 0, errors: 10 })),
    );
    expect(done.last).toMatch(/^verdict: inconclusive \(30 provider errors;/);
    expect(done.status).toBe(4);
  });

  it('names the cases and the mean in a failure of both', async () => {
    const done = await judge(
      changed(
        { caseName: 'a/one', passed: 0 },
        { caseName: 'a/two', passed: 0 },
      ),
    );
    expect(done.last).toBe(
      'verdict: fail (2 cases below their floor, mean below its floor)',
    );
    expect(done.status).toBe(1);
  });

  it('judges by the file of --config and not by gate.yaml', async () => {
    const strict = GATE_YAML.replace('a/one: 0.4', 'a/one: 0.9');
    const done = await judge(changed({ caseName: 'a/one', passed: 8 }), strict);
    expect(done.status).toBe(1);
  });

  it('exits 2 with an empty stdout for a file it cannot read', async () => {
    const dir = tempDir();
    const config = writeIn(dir, 'gate.yaml', GATE_YAML);
    const done = await gate([`${dir}/missing.json`, '--config', config]);
    expect(done.status).toBe(2);
    expect(done.stdout).toBe('');
    expect(done.stderr).toContain('missing.json');
  });
});
