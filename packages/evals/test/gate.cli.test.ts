import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gate } from '../src/gate/cli.js';
import {
  type Cell,
  GATE_YAML,
  resultsOf,
  tempDir,
  writeIn,
} from './gateFixture.js';

const exec = (args: string[]) => {
  let stdout = '';
  let stderr = '';
  const status = gate(args, {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
  });
  return { status, stdout, stderr };
};

const USAGE = 'Usage: gate <results.json> [--config <gate.yaml>]\n';

const setup = (cells: Cell[], yaml = GATE_YAML) => {
  const dir = tempDir();
  return {
    dir,
    results: writeIn(dir, 'results.json', JSON.stringify(resultsOf(cells))),
    config: writeIn(dir, 'gate.yaml', yaml),
  };
};

const cells: Cell[] = [
  { caseName: 'a/one', passed: 7, errors: 3 },
  { caseName: 'a/three', passed: 10 },
  { caseName: 'a/two', passed: 10 },
];

describe('gate: output', () => {
  it('prints a row per case sorted by id, then the mean, then the verdict', () => {
    const { results, config } = setup(cells);
    const { stdout, status } = exec([results, '--config', config]);
    const lines = stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(
      /^a\/one +c=7\/10 +err=3 +pass\^3=0\.2917 +floor 0\.4000 +below$/,
    );
    expect(lines[1]).toMatch(
      /^a\/three +c=10\/10 +err=0 +pass\^3=1\.0000 +floor 0\.0500 +ok$/,
    );
    expect(lines[2]).toMatch(/^a\/two +c=10\/10 /);
    expect(lines[3]).toMatch(/^mean +pass\^3=0\.7639 +floor 0\.8500 +below$/);
    expect(lines[4]).toBe(
      'verdict: inconclusive (3 provider errors; the breaches clear when they count as passed, run the gate again)',
    );
    expect(status).toBe(4);
  });

  it('ends a pass with `verdict: pass` and exit 0', () => {
    const { results, config } = setup(
      cells.map((cell) => ({ ...cell, passed: 10, errors: 0 })),
    );
    const { stdout, status, stderr } = exec([results, '--config', config]);
    expect(stdout.trimEnd().split('\n').at(-1)).toBe('verdict: pass');
    expect(status).toBe(0);
    expect(stderr).toBe('');
  });

  it('says a fail by its counts, with the singular for one case', () => {
    const { results, config } = setup([
      { caseName: 'a/one', passed: 7 },
      { caseName: 'a/three', passed: 10 },
      { caseName: 'a/two', passed: 10 },
    ]);
    const { stdout, status } = exec([results, '--config', config]);
    expect(stdout.trimEnd().split('\n').at(-1)).toBe(
      'verdict: fail (1 case below its floor, mean below its floor)',
    );
    expect(status).toBe(1);
  });
});

describe('gate: exact output', () => {
  const run = (cells: Cell[], mean: number) => {
    const { results, config } = setup(
      cells,
      GATE_YAML.replace('mean: 0.85', `mean: ${mean}`),
    );
    return exec([results, '--config', config]);
  };

  it('pads the case ids to the longest and separates columns by two spaces', () => {
    const { stdout } = run(
      [
        { caseName: 'a/one', passed: 10 },
        { caseName: 'a/three', passed: 10 },
        { caseName: 'a/two', passed: 10 },
      ],
      0.85,
    );
    expect(stdout).toBe(
      [
        'a/one    c=10/10  err=0  pass^3=1.0000  floor 0.4000  ok',
        'a/three  c=10/10  err=0  pass^3=1.0000  floor 0.0500  ok',
        'a/two    c=10/10  err=0  pass^3=1.0000  floor 0.4000  ok',
        'mean     pass^3=1.0000  floor 0.8500  ok',
        'verdict: pass',
        '',
      ].join('\n'),
    );
  });

  const last = (stdout: string) => stdout.trimEnd().split('\n').at(-1);
  const cells = (one: number, two: number): Cell[] => [
    { caseName: 'a/one', passed: one },
    { caseName: 'a/three', passed: 10 },
    { caseName: 'a/two', passed: two },
  ];

  it('says one case below its floor, alone', () => {
    expect(last(run(cells(7, 10), 0.1).stdout)).toBe(
      'verdict: fail (1 case below its floor)',
    );
  });

  it('says two cases below their floor, alone', () => {
    expect(last(run(cells(7, 7), 0.1).stdout)).toBe(
      'verdict: fail (2 cases below their floor)',
    );
  });

  it('says the mean below its floor, alone', () => {
    expect(last(run(cells(8, 8), 0.9).stdout)).toBe(
      'verdict: fail (mean below its floor)',
    );
  });

  it('says one provider error in the singular', () => {
    const { stdout } = run(
      [
        { caseName: 'a/one', passed: 7, errors: 1, failed: 2 },
        { caseName: 'a/three', passed: 10 },
        { caseName: 'a/two', passed: 10 },
      ],
      0.1,
    );
    // 7 passes and 1 error make 8, which clears its floor of 0.4.
    expect(last(stdout)).toBe(
      'verdict: inconclusive (1 provider error; the breaches clear when they count as passed, run the gate again)',
    );
  });
});

describe('gate: input it cannot judge', () => {
  const refuses = (args: string[], message: RegExp | string) => {
    const done = exec(args);
    expect(done.status).toBe(2);
    expect(done.stdout).toBe('');
    expect(done.stderr).toMatch(message);
    return done;
  };

  it('shows the usage for no argument', () => {
    const done = refuses([], 'results file is missing');
    expect(done.stderr).toContain(USAGE);
  });

  it('shows the usage for an extra argument or an unknown option', () => {
    const { results, config } = setup(cells);
    expect(refuses([results, 'other.json'], 'other.json').stderr).toContain(
      USAGE,
    );
    expect(refuses([results, '--bogus'], '--bogus').stderr).toContain(USAGE);
    expect(refuses([results, '--config'], '--config').stderr).toContain(USAGE);
    expect(
      refuses([results, '--config', config, '--config', config], '--config')
        .stderr,
    ).toContain(USAGE);
  });

  it('names a missing results file', () => {
    const { dir, config } = setup(cells);
    refuses(
      [path.join(dir, 'gone.json'), '--config', config],
      /Cannot read the results file .*gone\.json/,
    );
  });

  it('names a missing gate file', () => {
    const { dir, results } = setup(cells);
    refuses(
      [results, '--config', path.join(dir, 'gone.yaml')],
      /Cannot read the gate file .*gone\.yaml/,
    );
  });

  it('refuses an unknown option that comes before the results file', () => {
    const { results } = setup(cells);
    expect(
      refuses(['--bogus', results], 'Unexpected argument: --bogus').stderr,
    ).toContain(USAGE);
  });

  it('names a results file that is not JSON', () => {
    const { dir, config } = setup(cells);
    const bad = writeIn(dir, 'bad.json', '{ nope');
    refuses([bad, '--config', config], 'bad.json');
  });

  it('names a results file that is not a promptfoo file', () => {
    const { dir, config } = setup(cells);
    const bad = writeIn(dir, 'other.json', '{"a": 1}');
    refuses([bad, '--config', config], 'other.json');
  });

  it('names a gate file that is not YAML, and one with a bad key', () => {
    const { results, dir } = setup(cells);
    const broken = writeIn(dir, 'broken.yaml', 'a: [');
    refuses([results, '--config', broken], 'broken.yaml');
    const unknown = writeIn(dir, 'unknown.yaml', `${GATE_YAML}floor: 1\n`);
    refuses([results, '--config', unknown], /unknown\.yaml.*floor/s);
  });

  it('names a mismatch between the results and the gate file', () => {
    const { results, dir } = setup(cells);
    const other = writeIn(
      dir,
      'other.yaml',
      GATE_YAML.replace('model: m/one', 'model: m/two'),
    );
    refuses([results, '--config', other], /m\/one.*m\/two/s);
  });

  it('names the results file when it holds no run', () => {
    const { dir, config } = setup(cells);
    const empty = writeIn(
      dir,
      'empty.json',
      JSON.stringify({ results: { results: [] } }),
    );
    refuses([empty, '--config', config], /empty\.json.*no run/s);
  });

  it('reads gate.yaml of the package when no --config is given', () => {
    // The shipped file names the real core cases, so these cells mismatch it.
    const { results } = setup(cells);
    refuses([results], /claude-haiku-5\.5|m\/one/);
  });
});
