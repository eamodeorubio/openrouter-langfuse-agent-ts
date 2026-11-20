import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rejudge } from '../src/rejudge/rejudge.js';
import { report } from '../src/report/cli.js';
import { readRuns } from '../src/report/results.js';
import { catalogModel } from './oracleFixture.js';
import {
  ALL_PASS,
  savedRow,
  success,
  tempDir,
  writeConfig,
  writeRun,
} from './rejudgeFixture.js';

let root: string;
beforeAll(() => {
  root = writeConfig();
});

const execute = (argv: string[], configRoot = root) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = rejudge(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    { root: configRoot },
  );
  return { code, out: out.join(''), err: err.join('') };
};

const looked = success('Use `a/b`.', [{ output: '{"models":[{"id":"a/b"}]}' }]);
const noLookup = success('From memory.', []);

/** Two rows: one that flips (`memory-answer` failed as saved, passes now) and one that does not. */
const twoRows = () => [
  savedRow({
    caseId: 'fx/lookup',
    model: 'm/two',
    repeat: 4,
    output: looked,
    saved: [
      ALL_PASS[0] as never,
      { metric: 'memory-answer', pass: false, reason: 'No lookup.' },
      ALL_PASS[2] as never,
    ],
  }),
  savedRow({ caseId: 'fx/plain', output: noLookup, saved: ALL_PASS }),
];

const readJson = (file: string): unknown =>
  JSON.parse(fs.readFileSync(file, 'utf8'));

describe('rejudge: the arguments', () => {
  it.each([
    ['no argument', [], 'The results file is missing.'],
    ['two files', ['a.json', 'b.json'], 'Unexpected argument: b.json'],
    ['an option', ['--k', '3'], 'Unexpected argument: --k'],
    ['an option alone', ['--k'], 'Unexpected argument: --k'],
  ])('refuses %s with exit 2 and the usage', (_label, argv, message) => {
    const result = execute(argv);
    expect(result.code).toBe(2);
    expect(result.err).toContain(message);
    expect(result.err).toMatch(/Usage: rejudge <results\.json>/);
    expect(result.out).toBe('');
  });
});

describe('rejudge: the input', () => {
  it('names a file that is missing', () => {
    const result = execute(['/nonexistent/results.json']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('/nonexistent/results.json');
    expect(result.err).toMatch(/ENOENT/);
    expect(result.err).not.toMatch(/not JSON/);
  });

  it.each([
    ['not JSON', 'this is not json', /it is not JSON/],
    [
      'not a promptfoo results file',
      '{"results":{}}',
      /not a promptfoo results/,
    ],
    ['a list', '[]', /not a promptfoo results/],
    ['without rows', '{"results":{"results":"x"}}', /not a promptfoo results/],
  ])('names a file that is %s', (_label, content, message) => {
    const dir = tempDir();
    const file = path.join(dir, 'results.json');
    fs.writeFileSync(file, content);
    const result = execute([file]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(file);
    expect(result.err).toMatch(message);
  });

  it.each(['catalog.json', 'instructions.txt'])(
    'stops when %s is missing beside the file, and writes nothing',
    (missing) => {
      const file = writeRun(twoRows());
      fs.rmSync(path.join(path.dirname(file), missing));
      const result = execute([file]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(missing);
      expect(fs.existsSync(path.join(path.dirname(file), 'rejudged'))).toBe(
        false,
      );
    },
  );
});

describe('rejudge: rows it cannot judge', () => {
  const stops = (file: string, expected: RegExp, configRoot = root) => {
    const result = execute([file], configRoot);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(expected);
    expect(result.out).toBe('');
    expect(fs.existsSync(path.join(path.dirname(file), 'rejudged'))).toBe(
      false,
    );
  };

  it('stops at a case the config no longer holds, naming its id', () => {
    stops(
      writeRun([
        ...twoRows(),
        savedRow({ caseId: 'fx/gone', saved: ALL_PASS }),
      ]),
      /fx\/gone/,
    );
  });

  it('stops at an assertion it cannot name, naming the case and the metric', () => {
    const odd = writeConfig([
      {
        id: 'fx/odd',
        assert: [{ type: 'javascript', metric: 'inline', value: '1 + 1' }],
      },
    ]);
    stops(
      writeRun([savedRow({ caseId: 'fx/odd', saved: ALL_PASS })]),
      /fx\/odd.*inline/,
      odd,
    );
  });

  it('stops when a check throws, naming the case, the model and the repeat', () => {
    const broken = writeConfig([{ id: 'fx/broken', metadata: { bogus: 1 } }]);
    stops(
      writeRun([
        savedRow({
          caseId: 'fx/broken',
          model: 'm/two',
          repeat: 7,
          saved: ALL_PASS,
        }),
      ]),
      /fx\/broken.*m\/two.*repeat 7/s,
      broken,
    );
  });
});

describe('rejudge: the output', () => {
  it('prints the flips and the count, and exits 0', () => {
    const file = writeRun(twoRows());
    const result = execute([file]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      'fx/lookup | m/two | repeat 4 | memory-answer | fail → pass\n1 flip in 2 rows.\n',
    );
    expect(result.err).toBe('');
  });

  it('prints only the count when no verdict changed', () => {
    const file = writeRun([
      savedRow({ caseId: 'fx/lookup', output: looked, saved: ALL_PASS }),
    ]);
    const result = execute([file]);
    expect(result).toMatchObject({ code: 0, out: '0 flips in 1 row.\n' });
  });

  it('writes a run directory beside the input, and leaves the input as it was', () => {
    const file = writeRun(twoRows(), { target: 'ask-openrouter@1.2.0' });
    const dir = path.dirname(file);
    const before = fs.readFileSync(file);
    execute([file]);
    const out = path.join(dir, 'rejudged');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    for (const name of ['catalog.json', 'instructions.txt']) {
      expect(
        fs
          .readFileSync(path.join(out, name))
          .equals(fs.readFileSync(path.join(dir, name))),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(out, 'target.txt'), 'utf8')).toBe(
      'ask-openrouter@1.2.0 (re-judged)',
    );
    expect(fs.existsSync(path.join(out, 'results.json'))).toBe(true);
  });

  it('runs without a target.txt, and writes none', () => {
    const file = writeRun(twoRows(), { target: null });
    expect(execute([file]).code).toBe(0);
    expect(
      fs.existsSync(path.join(path.dirname(file), 'rejudged', 'target.txt')),
    ).toBe(false);
  });

  it('writes a file the report reads, with the new verdicts, and says in its first line that it is re-judged', () => {
    const file = writeRun(twoRows(), { target: 'ask-openrouter@1.2.0' });
    execute([file]);
    const rejudged = path.join(path.dirname(file), 'rejudged', 'results.json');
    const passes = (path: string): number =>
      readRuns(readJson(path)).runs.filter((run) => run.passed).length;
    // The flipped row passed as saved only if its memory-answer verdict was a failure that is now a pass.
    expect(passes(rejudged)).toBe(passes(file) + 1);
    const out: string[] = [];
    const code = report([rejudged, '--k', '1'], {
      out: (t) => out.push(t),
      err: () => {},
    });
    expect(code).toBe(0);
    expect(out.join('').split('\n')[0]).toBe(
      'target: ask-openrouter@1.2.0 (re-judged)',
    );
  });

  it('recomputes the counts of the stats, and leaves the rest of the file as it was', () => {
    const file = writeRun(twoRows());
    execute([file]);
    const saved = readJson(file) as {
      results: { stats: Record<string, number> };
    };
    const again = readJson(
      path.join(path.dirname(file), 'rejudged', 'results.json'),
    ) as { results: { stats: Record<string, number> } };
    expect(saved.results.stats).toMatchObject({ successes: 1, failures: 1 });
    expect(again.results.stats).toMatchObject({
      successes: 2,
      failures: 0,
      errors: 0,
      durationMs: 1000,
    });
  });

  it('counts successes, failures and provider errors apart in the stats', () => {
    const file = writeRun([
      savedRow({ caseId: 'fx/plain', output: noLookup, saved: ALL_PASS }),
      // Saved as a pass, fail now: no lookup succeeded.
      savedRow({ caseId: 'fx/lookup', output: noLookup, saved: ALL_PASS }),
      savedRow({ caseId: 'fx/lookup', output: noLookup, saved: ALL_PASS }),
      savedRow({ caseId: 'fx/plain', saved: [], providerError: true }),
    ]);
    execute([file]);
    const again = readJson(
      path.join(path.dirname(file), 'rejudged', 'results.json'),
    ) as { results: { stats: Record<string, number> } };
    expect(again.results.stats).toMatchObject({
      successes: 1,
      failures: 2,
      errors: 1,
    });
  });

  it('leaves a file without stats without stats', () => {
    const file = writeRun(twoRows());
    const saved = readJson(file) as { results: Record<string, unknown> };
    delete saved.results.stats;
    fs.writeFileSync(file, JSON.stringify(saved));
    expect(execute([file]).code).toBe(0);
    const again = readJson(
      path.join(path.dirname(file), 'rejudged', 'results.json'),
    ) as { results: Record<string, unknown> };
    expect('stats' in again.results).toBe(false);
  });

  it('is idempotent: judging the output again finds no flip, writes an equal file and adds no second mark', () => {
    const file = writeRun(twoRows(), { target: 'ask-openrouter@1.2.0' });
    execute([file]);
    const first = path.join(path.dirname(file), 'rejudged');
    const second = execute([path.join(first, 'results.json')]);
    expect(second.out).toBe('0 flips in 2 rows.\n');
    expect(readJson(path.join(first, 'rejudged', 'results.json'))).toEqual(
      readJson(path.join(first, 'results.json')),
    );
    expect(
      fs.readFileSync(path.join(first, 'rejudged', 'target.txt'), 'utf8'),
    ).toBe('ask-openrouter@1.2.0 (re-judged)');
  });

  it('leaves no target.txt from an earlier re-judge when the input has none', () => {
    const file = writeRun(twoRows());
    const dir = path.dirname(file);
    fs.writeFileSync(path.join(dir, 'target.txt'), 'ask-openrouter@1.2.0');
    execute([file]);
    fs.rmSync(path.join(dir, 'target.txt'));
    execute([file]);
    expect(fs.existsSync(path.join(dir, 'rejudged', 'target.txt'))).toBe(false);
  });

  it('makes no request', () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    try {
      expect(execute([writeRun(twoRows())]).code).toBe(0);
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      fetched.mockRestore();
    }
  });

  it('overwrites the output of an earlier re-judge', () => {
    const file = writeRun(twoRows());
    execute([file]);
    expect(execute([file]).code).toBe(0);
  });
});

describe('rejudge: each run against its own snapshot', () => {
  const ghost = success('Try zz/ghost.', [{ output: '{"models":[]}' }]);
  const rows = () => [
    savedRow({ caseId: 'fx/lookup', output: ghost, saved: ALL_PASS }),
  ];

  it('judges against the catalog.json beside each file, in one process', () => {
    // An author the catalog holds makes an unsourced slug of it an invention.
    const known = writeRun(rows(), {
      models: [catalogModel('zz/known', 1000, true, 1, 1)],
    });
    const empty = writeRun(rows(), { models: [] });
    expect(execute([known]).out).toContain(
      'fx/lookup | m/one | repeat 0 | invented-data | pass → fail',
    );
    expect(execute([empty]).out).toBe('0 flips in 1 row.\n');
    expect(execute([known]).out).toContain('invented-data');
  });

  it('judges against the instructions.txt beside each file', () => {
    const leak = writeConfig([
      {
        id: 'fx/leak',
        checks: [{ metric: 'prompt-leak', name: 'promptLeak' }],
      },
    ]);
    const answer = success(
      'the quick brown fox jumps over the lazy dog today',
      [{}],
    );
    const saved = [
      ...ALL_PASS,
      { metric: 'prompt-leak', pass: true, reason: 'x' },
    ];
    const rowsOf = () => [
      savedRow({ caseId: 'fx/leak', output: answer, saved }),
    ];
    const holding = writeRun(rowsOf(), {
      instructions: 'Rule: the quick brown fox jumps over the lazy dog.',
    });
    const other = writeRun(rowsOf(), { instructions: 'Nothing alike.' });
    expect(execute([holding], leak).out).toContain('prompt-leak | pass → fail');
    expect(execute([other], leak).out).toBe('0 flips in 1 row.\n');
  });

  it('restores the environment, after a run and after a failure', () => {
    process.env.EVAL_CATALOG = '/keep/catalog.json';
    delete process.env.EVAL_INSTRUCTIONS;
    execute([writeRun(rows())]);
    execute([writeRun([savedRow({ caseId: 'fx/gone', saved: ALL_PASS })])]);
    expect(process.env.EVAL_CATALOG).toBe('/keep/catalog.json');
    expect(process.env.EVAL_INSTRUCTIONS).toBeUndefined();
    delete process.env.EVAL_CATALOG;
  });
});
