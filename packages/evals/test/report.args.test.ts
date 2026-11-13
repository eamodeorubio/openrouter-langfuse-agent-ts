import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { report } from '../src/report/cli.js';
import { passAtK, passHatK } from '../src/report/estimators.js';
import { readRuns } from '../src/report/results.js';
import { summarize } from '../src/report/summary.js';
import { many, resultsFile, run } from './resultsFixture.js';

const write = (content: string) => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'evals-args-')),
    'results.json',
  );
  fs.writeFileSync(file, content);
  return file;
};

const exec = (args: string[]) => {
  let stdout = '';
  let stderr = '';
  const status = report(args, {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
  });
  return { status, stdout, stderr };
};

const USAGE = 'Usage: report <results.json> [--k 1,3,5]\n';
const file = () => write(JSON.stringify(resultsFile(many(6))));

describe('the arguments of the report', () => {
  it('print the usage and exit 2 without a results file', () => {
    expect(exec([])).toEqual({
      status: 2,
      stdout: '',
      stderr: `The results file is missing.\n${USAGE}`,
    });
  });

  it('refuse a second file and an option it does not know', () => {
    expect(exec(['a.json', 'b.json'])).toEqual({
      status: 2,
      stdout: '',
      stderr: `Unexpected argument: b.json\n${USAGE}`,
    });
    expect(exec(['--bogus', 'a.json']).stderr).toBe(
      `Unexpected argument: --bogus\n${USAGE}`,
    );
  });

  it.each([['1,0'], ['1.5'], ['a'], [''], ['1,,3'], ['-1']])(
    'refuse --k %j and say what it takes',
    (value) => {
      expect(exec([file(), '--k', value])).toEqual({
        status: 2,
        stdout: '',
        stderr: `--k takes whole numbers from 1, such as 1,3,5.\n${USAGE}`,
      });
    },
  );

  it('refuse --k without a value', () => {
    expect(exec([file(), '--k']).status).toBe(2);
  });

  it('take the file after the options as well as before', () => {
    expect(exec(['--k', '2', file()]).status).toBe(0);
  });

  it('print the estimators for 1, 3 and 5 unless --k says otherwise', () => {
    const { stdout } = exec([file()]);
    for (const k of [1, 3, 5]) {
      expect(stdout).toContain(`pass@${k}=`);
    }
    expect(stdout).not.toContain('pass@2=');
  });

  it('print only the k it was given', () => {
    const { stdout } = exec([file(), '--k', '2,4']);
    expect(stdout).toContain('pass@2=');
    expect(stdout).toContain('pass^4=');
    expect(stdout).not.toContain('pass@1=');
  });

  it('say which file it could not read', () => {
    const missing = path.join(os.tmpdir(), 'evals-none', 'results.json');
    const result = exec([missing]);
    expect(result.status).toBe(1);
    expect(result.stderr.startsWith(`Cannot report on ${missing}: `)).toBe(
      true,
    );
    expect(result.stderr.endsWith('\n')).toBe(true);
  });

  it('say that a file that is not JSON cannot be read, with the reason', () => {
    const bad = write('not json');
    const result = exec([bad]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(`^Cannot report on ${bad}: .*JSON`),
    );
  });

  it('say that a file with no results is not a promptfoo results file', () => {
    const result = exec([write('{"a":1}')]);
    expect(result.stderr).toMatch(/is not a promptfoo results file/);
  });
});

describe('the summary of the runs', () => {
  const summary = () => {
    const runs = [
      ...many(3, { model: 'm/one', caseName: 'A1' }),
      ...many(2, { model: 'm/one', caseName: 'B7', failed: ['x'] }),
      ...many(4, { model: 'm/two', caseName: 'A1' }),
      run({ model: 'm/one', caseName: 'A1', failed: ['y'] }),
    ];
    return summarize(readRuns(resultsFile(runs)).runs, [1], 0.7);
  };

  it('groups the runs by model, then by case, each cell with only its own runs', () => {
    const [one, two] = summary();
    expect(one?.cells.map((cell) => [cell.case, cell.n, cell.c])).toEqual([
      ['A1', 4, 3],
      ['B7', 2, 0],
    ]);
    expect(two?.cells.map((cell) => [cell.case, cell.n, cell.c])).toEqual([
      ['A1', 4, 4],
    ]);
  });

  it('pools the runs of a model in its row, and the runs of no other model', () => {
    const [one, two] = summary();
    expect([one?.row.n, one?.row.c]).toEqual([6, 3]);
    expect([two?.row.n, two?.row.c]).toEqual([4, 4]);
    expect(one?.row.failures).toEqual({ x: 2, y: 1 });
  });

  it('lists the models and the cases in the order they first appear', () => {
    const [first, second] = summarize(
      readRuns(
        resultsFile([
          run({ model: 'm/b', caseName: 'Z' }),
          run({ model: 'm/a', caseName: 'Y' }),
          run({ model: 'm/b', caseName: 'X' }),
        ]),
      ).runs,
      [1],
      0.7,
    );
    expect([first?.model, second?.model]).toEqual(['m/b', 'm/a']);
    expect(first?.cells.map((cell) => cell.case)).toEqual(['Z', 'X']);
  });
});

describe('the messages of the estimators', () => {
  it('say what was wrong, with the numbers', () => {
    expect(() => passAtK(0, 0, 1)).toThrow(
      'n must be a whole number of at least 1, got 0.',
    );
    expect(() => passAtK(4, 5, 1)).toThrow(
      'c must be a whole number from 0 to n=4, got 5.',
    );
    expect(() => passHatK(4, 2, 5)).toThrow(
      'k must be a whole number from 1 to n=4, got k=5.',
    );
  });
});

describe('the wall time in the report', () => {
  it('is the last line, after the models', () => {
    const results = write(
      JSON.stringify(
        resultsFile(many(6), 0.7, { durationMs: 12345, maxConcurrency: 4 }),
      ),
    );
    const { stdout } = exec([results]);
    expect(
      stdout.endsWith('\nwall time 12.3 s for 6 runs (concurrency 4)\n'),
    ).toBe(true);
  });

  it('is left out when the file has none', () => {
    expect(exec([file()]).stdout).not.toContain('wall time');
  });
});
