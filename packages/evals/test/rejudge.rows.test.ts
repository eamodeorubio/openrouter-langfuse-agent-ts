import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { rejudgeRow } from '../src/rejudge/rows.js';
import { loadSuite, RejudgeError, type Suite } from '../src/rejudge/suite.js';
import {
  ALL_PASS,
  FIXTURE_CASES,
  savedRow,
  success,
  writeConfig,
} from './rejudgeFixture.js';

let suite: Suite;
beforeAll(() => {
  suite = loadSuite(writeConfig(FIXTURE_CASES));
});

const field = (row: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (at, key) => (at as Record<string, unknown> | undefined)?.[key],
    row,
  );

/** A run that looked a model up and answered. */
const looked = success('Use `a/b`.', [{ output: '{"models":[{"id":"a/b"}]}' }]);

describe('rejudgeRow', () => {
  it('finds no flip when the saved verdicts are the current ones, and returns the same pass, score and reason', () => {
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: looked,
      saved: ALL_PASS,
      rubrics: { 'judge-relevance': 0.8 },
    });
    const { row, flips } = rejudgeRow(entry, suite);
    expect(flips).toEqual([]);
    expect(row).toEqual(entry);
  });

  it('turns a failed check that now passes into a flip, and the row into a pass', () => {
    // The saved run says no lookup succeeded. The output holds one that did.
    const entry = savedRow({
      caseId: 'fx/lookup',
      model: 'm/two',
      repeat: 4,
      output: looked,
      saved: [
        { metric: 'run-failed', pass: true },
        { metric: 'memory-answer', pass: false, reason: 'No lookup.' },
        { metric: 'invented-data', pass: true },
      ],
    });
    const { row, flips } = rejudgeRow(entry, suite);
    expect(flips).toEqual([
      {
        caseId: 'fx/lookup',
        model: 'm/two',
        repeat: 4,
        metric: 'memory-answer',
        before: 'fail',
        after: 'pass',
      },
    ]);
    expect(row).toEqual(
      savedRow({
        caseId: 'fx/lookup',
        model: 'm/two',
        repeat: 4,
        output: looked,
        saved: ALL_PASS,
      }),
    );
  });

  it('turns a passed check that now fails into a flip, with the reason of the last failure as the reason of the row', () => {
    const noLookup = success('From memory, `a/b`.', [{ failed: true }]);
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: noLookup,
      saved: ALL_PASS,
    });
    const { row, flips } = rejudgeRow(entry, suite);
    expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
      ['memory-answer', 'pass', 'fail'],
    ]);
    expect(field(row, 'success')).toBe(false);
    expect(field(row, 'failureReason')).toBe(1);
    expect(field(row, 'score')).toBeCloseTo(2 / 3);
    expect(field(row, 'gradingResult', 'pass')).toBe(false);
    expect(field(row, 'gradingResult', 'reason')).toBe(
      'The case needs a lookup and no tool call succeeded.',
    );
    expect(field(row, 'error')).toBe(
      'The case needs a lookup and no tool call succeeded.',
    );
    expect(field(row, 'namedScores', 'memory-answer')).toBe(0);
    expect(field(row, 'gradingResult', 'namedScores', 'memory-answer')).toBe(0);
  });

  it('keeps the rubric results as saved, whatever the verdicts', () => {
    const noLookup = success('From memory.', []);
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: noLookup,
      saved: ALL_PASS,
      rubrics: { 'judge-relevance': 0.81, 'judge-grounding': 0.12 },
    });
    const { row } = rejudgeRow(entry, suite);
    const components = field(row, 'gradingResult', 'componentResults') as {
      assertion: { type: string; metric: string };
      score: number;
    }[];
    const rubrics = components.filter((c) => c.assertion.type === 'llm-rubric');
    expect(rubrics.map((c) => [c.assertion.metric, c.score])).toEqual([
      ['judge-relevance', 0.81],
      ['judge-grounding', 0.12],
    ]);
    expect(field(row, 'namedScores', 'judge-relevance')).toBe(0.81);
  });

  it('copies a row that ended in a provider error, and finds no flip in it', () => {
    const entry = savedRow({
      caseId: 'fx/lookup',
      saved: [],
      providerError: true,
    });
    const { row, flips } = rejudgeRow(entry, suite);
    expect(flips).toEqual([]);
    expect(row).toEqual(entry);
  });

  it('does not modify the row it was given', () => {
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: success('From memory.', []),
      saved: ALL_PASS,
    });
    const before = structuredClone(entry);
    rejudgeRow(entry, suite);
    expect(entry).toEqual(before);
  });

  it('judges with the metadata of the case in the current config, not the saved one', () => {
    // The saved case says nothing of a lookup. The current one needs it.
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: success('From memory.', []),
      saved: ALL_PASS,
    });
    expect(field(entry, 'testCase', 'metadata')).toEqual({ id: 'fx/lookup' });
    const { flips } = rejudgeRow(entry, suite);
    expect(flips.map((f) => f.metric)).toEqual(['memory-answer']);
  });

  it('counts a metric the current config added, or removed, as a flip against absent', () => {
    const other = loadSuite(
      writeConfig(
        [
          {
            id: 'fx/lookup',
            checks: [{ metric: 'wrong-answer', name: 'wrongAnswer' }],
          },
        ],
        [
          {
            type: 'javascript',
            metric: 'run-failed',
            value: 'file://src/checks/assertions.ts:runFailed',
          },
        ],
      ),
    );
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: looked,
      saved: [
        { metric: 'run-failed', pass: true },
        { metric: 'memory-answer', pass: true },
      ],
    });
    const { row, flips } = rejudgeRow(entry, other);
    expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
      ['wrong-answer', 'absent', 'pass'],
      ['memory-answer', 'pass', 'absent'],
    ]);
    const metrics = (
      field(row, 'gradingResult', 'componentResults') as {
        assertion: { metric: string };
      }[]
    ).map((c) => c.assertion.metric);
    expect(metrics).toEqual(['run-failed', 'wrong-answer']);
    expect(field(row, 'namedScores', 'memory-answer')).toBeUndefined();
    expect(
      field(row, 'gradingResult', 'namedScoreWeights', 'memory-answer'),
    ).toBeUndefined();
    expect(
      field(row, 'gradingResult', 'namedScoreWeights', 'wrong-answer'),
    ).toBe(1);
  });

  describe('two checks of one metric', () => {
    // `invented-data` is a check of every case and the metric of a second check on some.
    const twice = () =>
      loadSuite(
        writeConfig([
          {
            id: 'fx/twice',
            checks: [{ metric: 'invented-data', name: 'runFailed' }],
          },
        ]),
      );
    const both = (second: boolean) => [
      ALL_PASS[0] as never,
      ALL_PASS[1] as never,
      ALL_PASS[2] as never,
      { metric: 'invented-data', pass: second, reason: 'The answer is empty.' },
    ];

    it('pairs them in order, so unchanged verdicts are no flip', () => {
      const entry = savedRow({
        caseId: 'fx/twice',
        output: looked,
        saved: [
          ...both(true).slice(0, 3),
          {
            metric: 'invented-data',
            pass: true,
            reason: 'The run has an answer.',
          },
        ],
      });
      expect(rejudgeRow(entry, twice()).flips).toEqual([]);
    });

    it('flips the one that changed, and not the one beside it', () => {
      const entry = savedRow({
        caseId: 'fx/twice',
        output: looked,
        saved: both(false),
      });
      const { row, flips } = rejudgeRow(entry, twice());
      expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
        ['invented-data', 'fail', 'pass'],
      ]);
      expect(field(row, 'success')).toBe(true);
    });

    it('records the mean of their scores and their number, as promptfoo does for a metric of two checks', () => {
      const mixed = loadSuite(
        writeConfig([
          {
            id: 'fx/mixed',
            metadata: { needsLookup: true },
            checks: [{ metric: 'invented-data', name: 'memoryAnswer' }],
          },
        ]),
      );
      // No name to invent, so the first check passes. No lookup succeeded, so the second fails.
      const entry = savedRow({
        caseId: 'fx/mixed',
        output: success('From memory.', []),
        saved: both(true),
      });
      const { row } = rejudgeRow(entry, mixed);
      expect(field(row, 'namedScores', 'invented-data')).toBe(0.5);
      expect(field(row, 'gradingResult', 'namedScores', 'invented-data')).toBe(
        0.5,
      );
      expect(
        field(row, 'gradingResult', 'namedScoreWeights', 'invented-data'),
      ).toBe(2);
      expect(
        field(row, 'gradingResult', 'namedScoreWeights', 'run-failed'),
      ).toBe(1);
    });

    it('reports a second check of a metric the saved row lacks as absent → verdict', () => {
      const entry = savedRow({
        caseId: 'fx/twice',
        output: looked,
        saved: ALL_PASS,
      });
      expect(
        rejudgeRow(entry, twice()).flips.map((f) => [
          f.metric,
          f.before,
          f.after,
        ]),
      ).toEqual([['invented-data', 'absent', 'pass']]);
    });
  });

  it('refuses a case the config does not hold, naming its id', () => {
    const entry = savedRow({ caseId: 'fx/gone', saved: ALL_PASS });
    expect(() => rejudgeRow(entry, suite)).toThrow(RejudgeError);
    expect(() => rejudgeRow(entry, suite)).toThrow(/fx\/gone/);
  });

  it('refuses a row with no case id', () => {
    expect(() => rejudgeRow({ vars: { model: 'm/one' } }, suite)).toThrow(
      /metadata\.id/,
    );
    expect(() => rejudgeRow('not a row', suite)).toThrow(RejudgeError);
  });

  it('refuses an assertion it cannot name, naming the case and the metric', () => {
    const odd = loadSuite(
      writeConfig([
        {
          id: 'fx/odd',
          assert: [
            {
              type: 'javascript',
              metric: 'inline',
              value: 'output.length > 0',
            },
          ],
        },
      ]),
    );
    const entry = savedRow({ caseId: 'fx/odd', saved: ALL_PASS });
    expect(() => rejudgeRow(entry, odd)).toThrow(/fx\/odd.*inline/);
  });

  it('names the case, the model and the repeat when a check throws', () => {
    const broken = loadSuite(
      writeConfig([{ id: 'fx/broken', metadata: { bogus: 1 } }]),
    );
    const entry = savedRow({
      caseId: 'fx/broken',
      model: 'm/two',
      repeat: 7,
      saved: ALL_PASS,
    });
    expect(() => rejudgeRow(entry, broken)).toThrow(
      /fx\/broken.*m\/two.*repeat 7/s,
    );
  });
});

describe('rejudgeRow: rubrics never decide', () => {
  it('passes a row whose checks pass, whatever a rubric saved as passed', () => {
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: looked,
      saved: ALL_PASS,
      rubrics: { 'judge-relevance': 0.1 },
    });
    // A rubric that Jev did not answer, or that scored low, is saved with pass: false.
    const components = (
      entry.gradingResult as { componentResults: { pass: boolean }[] }
    ).componentResults;
    (components[components.length - 1] as { pass: boolean }).pass = false;
    const { row, flips } = rejudgeRow(entry, suite);
    expect(flips).toEqual([]);
    expect(field(row, 'success')).toBe(true);
    expect(field(row, 'failureReason')).toBe(0);
    expect(field(row, 'gradingResult', 'reason')).toBe('All assertions passed');
    expect(field(row, 'error')).toBeUndefined();
  });

  it('takes the reason of the row from the last failing check, not from a rubric', () => {
    const entry = savedRow({
      caseId: 'fx/lookup',
      output: success('From memory.', []),
      saved: ALL_PASS,
      rubrics: { 'judge-relevance': 0.1 },
    });
    const components = (
      entry.gradingResult as { componentResults: { pass: boolean }[] }
    ).componentResults;
    (components[components.length - 1] as { pass: boolean }).pass = false;
    expect(field(rejudgeRow(entry, suite).row, 'error')).toBe(
      'The case needs a lookup and no tool call succeeded.',
    );
  });
});

describe('rejudgeRow: odd rows', () => {
  const bare = (over: Record<string, unknown> = {}) => ({
    vars: { model: 'm/one' },
    repeatIndex: 0,
    testCase: { metadata: { id: 'fx/lookup' } },
    response: { output: looked },
    ...over,
  });

  it('says what is wrong with a result that is no object', () => {
    expect(() => rejudgeRow(42, suite)).toThrow(/is not an object/);
  });

  it.each([
    ['empty', ''],
    ['a number', 42],
    ['absent', undefined],
  ])('refuses a case id that is %s', (_label, id) => {
    const entry = bare({ testCase: { metadata: { id } } });
    expect(() => rejudgeRow(entry, suite)).toThrow(/testCase\.metadata\.id/);
  });

  it('judges a row with no saved grading, every check being absent before', () => {
    const { row, flips } = rejudgeRow(bare(), suite);
    expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
      ['run-failed', 'absent', 'pass'],
      ['memory-answer', 'absent', 'pass'],
      ['invented-data', 'absent', 'pass'],
    ]);
    expect(field(row, 'success')).toBe(true);
  });

  it('names a row with no model', () => {
    const entry = bare({ vars: {} });
    expect(rejudgeRow(entry, suite).flips[0]?.model).toBe('(no model)');
  });

  it('copies a row that has an error and no failure reason, whatever its case', () => {
    const entry = bare({
      testCase: { metadata: { id: 'fx/gone' } },
      response: { error: 'boom' },
    });
    expect(rejudgeRow(entry, suite)).toEqual({ row: entry, flips: [] });
  });

  it('does not take an error that is no text for a provider error', () => {
    const entry = bare({
      testCase: { metadata: { id: 'fx/gone' } },
      response: { error: 5 },
    });
    expect(() => rejudgeRow(entry, suite)).toThrow(/fx\/gone/);
  });

  it('does not take a row with a failure reason for a provider error because of its response', () => {
    const entry = bare({
      failureReason: 1,
      response: { error: 'x', output: looked },
    });
    expect(rejudgeRow(entry, suite).flips).toHaveLength(3);
  });

  it('copies a row whose failure reason is 2, whatever its case', () => {
    const entry = bare({
      testCase: { metadata: { id: 'fx/gone' } },
      failureReason: 2,
    });
    expect(rejudgeRow(entry, suite)).toEqual({ row: entry, flips: [] });
  });

  it('scores a row that has no check at all as 0', () => {
    const none = loadSuite(writeConfig([{ id: 'fx/none', assert: [] }], []));
    const entry = savedRow({
      caseId: 'fx/none',
      saved: [],
      rubrics: { 'judge-relevance': 0.7 },
    });
    expect(field(rejudgeRow(entry, none).row, 'score')).toBe(0);
  });

  it('pairs the checks of one metric in order, the first with the first', () => {
    const mixed = loadSuite(
      writeConfig([
        {
          id: 'fx/mixed',
          metadata: { needsLookup: true },
          checks: [{ metric: 'invented-data', name: 'memoryAnswer' }],
        },
      ]),
    );
    // The saved row has one `invented-data` check. The config has two, and the second fails.
    const entry = savedRow({
      caseId: 'fx/mixed',
      output: success('From memory.', []),
      saved: [ALL_PASS[0] as never, ALL_PASS[1] as never, ALL_PASS[2] as never],
    });
    const { flips } = rejudgeRow(entry, mixed);
    expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
      ['memory-answer', 'pass', 'fail'],
      ['invented-data', 'absent', 'fail'],
    ]);
  });

  it('pairs by metric, so a check added earlier in the row shifts nothing', () => {
    const added = loadSuite(
      writeConfig(
        [{ id: 'fx/added' }],
        [
          {
            type: 'javascript',
            metric: 'run-failed',
            value: 'file://src/checks/assertions.ts:runFailed',
          },
          {
            type: 'javascript',
            metric: 'memory-answer',
            value: 'file://src/checks/assertions.ts:memoryAnswer',
          },
          {
            type: 'javascript',
            metric: 'invented-data',
            value: 'file://src/checks/assertions.ts:inventedModels',
          },
        ],
      ),
    );
    const entry = savedRow({
      caseId: 'fx/added',
      output: looked,
      saved: [ALL_PASS[0] as never, ALL_PASS[2] as never],
    });
    expect(
      rejudgeRow(entry, added).flips.map((f) => [f.metric, f.before, f.after]),
    ).toEqual([['memory-answer', 'absent', 'pass']]);
  });

  it('reads a case whose assert is no list as having no check', () => {
    const odd = loadSuite(
      writeConfig([{ id: 'fx/odd', assert: 'text' as never }]),
    );
    expect(odd.cases.get('fx/odd')?.assert).toEqual([]);
  });

  it('pairs three checks of one metric one by one', () => {
    const three = loadSuite(
      writeConfig([
        {
          id: 'fx/three',
          checks: [
            { metric: 'invented-data', name: 'runFailed' },
            { metric: 'invented-data', name: 'runFailed' },
          ],
        },
      ]),
    );
    const pass = { metric: 'invented-data', pass: true, reason: 'x' };
    const entry = savedRow({
      caseId: 'fx/three',
      output: looked,
      saved: [
        ALL_PASS[0] as never,
        ALL_PASS[1] as never,
        ALL_PASS[2] as never,
        { ...pass, pass: false },
        pass,
      ],
    });
    const { flips } = rejudgeRow(entry, three);
    expect(flips.map((f) => [f.metric, f.before, f.after])).toEqual([
      ['invented-data', 'fail', 'pass'],
    ]);
  });
});

describe('rejudgeRow properties', () => {
  const outputs = fc.record({
    answer: fc.constantFrom('', '  ', 'Use `a/b`.', 'Maybe `zz/ghost`.'),
    calls: fc.array(fc.boolean(), { maxLength: 3 }),
  });
  const verdicts = fc.record({
    runFailed: fc.boolean(),
    memory: fc.boolean(),
    invented: fc.boolean(),
  });
  const build = (
    o: { answer: string; calls: boolean[] },
    v: { runFailed: boolean; memory: boolean; invented: boolean },
    caseId: string,
  ) =>
    savedRow({
      caseId,
      output: success(
        o.answer,
        o.calls.map((failed) => ({ failed })),
      ),
      saved: [
        { metric: 'run-failed', pass: v.runFailed },
        { metric: 'memory-answer', pass: v.memory },
        { metric: 'invented-data', pass: v.invented },
      ],
      rubrics: { 'judge-relevance': 0.5 },
    });

  it('is idempotent: judging a judged row finds no flip and changes nothing', () => {
    fc.assert(
      fc.property(
        outputs,
        verdicts,
        fc.constantFrom('fx/lookup', 'fx/plain'),
        (o, v, caseId) => {
          const once = rejudgeRow(build(o, v, caseId), suite);
          const twice = rejudgeRow(once.row, suite);
          expect(twice.flips).toEqual([]);
          expect(twice.row).toEqual(once.row);
        },
      ),
    );
  });

  it('passes the row exactly when every javascript check passes, and scores the share that pass', () => {
    fc.assert(
      fc.property(outputs, verdicts, (o, v) => {
        const { row } = rejudgeRow(build(o, v, 'fx/lookup'), suite);
        const components = field(row, 'gradingResult', 'componentResults') as {
          pass: boolean;
          assertion: { type: string };
        }[];
        const checks = components.filter(
          (c) => c.assertion.type === 'javascript',
        );
        const passing = checks.filter((c) => c.pass).length;
        expect(field(row, 'success')).toBe(passing === checks.length);
        expect(field(row, 'score')).toBeCloseTo(passing / checks.length);
        expect(field(row, 'failureReason')).toBe(
          passing === checks.length ? 0 : 1,
        );
      }),
    );
  });

  it('never throws on a row of any shape that is not an error, other than a RejudgeError', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        try {
          rejudgeRow(value, suite);
        } catch (error) {
          expect(error).toBeInstanceOf(RejudgeError);
        }
      }),
    );
  });
});
