import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectRecords, runCollect } from '../src/calibrate/collect.js';
import { DEFAULT_CALIBRATION_FILE } from '../src/calibrate/records.js';
import {
  grounding,
  relevance,
  toolUsage,
  usefulness,
} from '../src/judge/state.js';

const calls = [
  {
    round: 1,
    name: 'get_model',
    arguments: '{"slug":"a/b"}',
    output: '{"id":"a/b","pricing":{"prompt":1}}',
    failed: false,
  },
];

const component = (metric: string, score: number, reason: string) => ({
  pass: true,
  score,
  reason,
  assertion: { type: 'llm-rubric', metric, weight: 0 },
});
const answered = (metric: string, score: number) =>
  component(metric, score, `Jev Noul probability ${score} >= threshold 0.5`);

const entry = (over: Record<string, unknown> = {}) => ({
  vars: { model: 'm/one', question: 'What does a/b cost?' },
  testCase: { metadata: { id: 'lookup/known-model' } },
  repeatIndex: 3,
  success: true,
  failureReason: 0,
  namedScores: {},
  response: {
    output: {
      success: true,
      question: 'What does a/b cost?',
      answer: 'a/b costs $1 per million tokens.',
      toolCalls: calls,
    },
  },
  gradingResult: {
    componentResults: [
      answered('judge-grounding', 0.57),
      answered('judge-relevance', 0.95),
      answered('judge-usefulness', 0.86),
      answered('judge-tool-usage', 0.95),
    ],
  },
  ...over,
});
const file = (entries: unknown[]) => ({ results: { results: entries } });

describe('collectRecords', () => {
  it('writes a record for a graded run: its prompt, its transcript, its states and its scores', () => {
    const [record] = collectRecords(file([entry()]));
    const output = entry().response.output;
    expect(record).toEqual({
      id: 'lookup/known-model::m/one::3',
      case: 'lookup/known-model',
      model: 'm/one',
      repeat: 3,
      prompt: 'What does a/b cost?',
      transcript: { toolCalls: calls, answer: output.answer },
      states: {
        'judge-grounding': grounding(output, {}),
        'judge-relevance': relevance(output, {}),
        'judge-usefulness': usefulness(output, {}),
        'judge-tool-usage': toolUsage(output, {}),
      },
      jevAssertScores: {
        'judge-grounding': 0.57,
        'judge-relevance': 0.95,
        'judge-usefulness': 0.86,
        'judge-tool-usage': 0.95,
      },
    });
  });

  it('keeps a state for each rubric asked, and a score only for the rubrics Jev answered', () => {
    const [record] = collectRecords(
      file([
        entry({
          gradingResult: {
            componentResults: [
              answered('judge-relevance', 0.9),
              component(
                'judge-grounding',
                0,
                'The state is too large: 40000 bytes, over the limit of 32000.',
              ),
            ],
          },
        }),
      ]),
    );
    expect(Object.keys(record?.states ?? {}).sort()).toEqual([
      'judge-grounding',
      'judge-relevance',
    ]);
    expect(record?.jevAssertScores).toEqual({ 'judge-relevance': 0.9 });
  });

  it('collects no run that ended in a provider error, and none that no rubric graded', () => {
    const records = collectRecords(
      file([
        entry({ failureReason: 2, success: false }),
        entry({ gradingResult: { componentResults: [] } }),
        entry({ gradingResult: undefined }),
        entry({ repeatIndex: 4 }),
      ]),
    );
    expect(records.map((r) => r.repeat)).toEqual([4]);
  });

  it('gives each run its own id, whatever the case, the model and the repeat', () => {
    const records = collectRecords(
      file([
        entry({ repeatIndex: 0 }),
        entry({ repeatIndex: 1 }),
        entry({ vars: { model: 'm/two', question: 'q' }, repeatIndex: 0 }),
        entry({
          testCase: { metadata: { id: 'search/count' } },
          repeatIndex: 0,
        }),
      ]),
    );
    expect(new Set(records.map((r) => r.id)).size).toBe(4);
  });

  it('reads the prompt from the output, and from the case when the output holds none, and is empty with neither', () => {
    const noQuestion = (vars: unknown) => {
      const base = entry();
      return entry({
        vars,
        response: { output: { ...base.response.output, question: undefined } },
      });
    };
    expect(
      collectRecords(file([noQuestion({ question: 'From the case' })]))[0]
        ?.prompt,
    ).toBe('From the case');
    expect(collectRecords(file([noQuestion({})]))[0]?.prompt).toBe('');
    expect(
      collectRecords(file([noQuestion({ question: '' })]))[0]?.prompt,
    ).toBe('');
    // The state of a rubric reads the same question, so that Jev saw it.
    expect(
      collectRecords(file([noQuestion({ question: 'From the case' })]))[0]
        ?.states['judge-relevance'],
    ).toContain('Question: From the case');
  });

  it('takes a prompt only from text, and not from a number', () => {
    const base = entry();
    const odd = entry({
      vars: { model: 'm/one', question: 3 },
      response: { output: { ...base.response.output, question: 7 } },
    });
    expect(collectRecords(file([odd]))[0]?.prompt).toBe('');
  });

  it('numbers a run by its place when promptfoo gave it no repeat index', () => {
    const records = collectRecords(
      file([
        entry({ repeatIndex: undefined }),
        entry({ repeatIndex: undefined }),
      ]),
    );
    expect(records.map((r) => [r.repeat, r.id])).toEqual([
      [0, 'lookup/known-model::m/one::0'],
      [1, 'lookup/known-model::m/one::1'],
    ]);
  });

  it('leaves out a rubric it has no builder for, and a run whose output is no success object', () => {
    const [record] = collectRecords(
      file([
        entry({
          gradingResult: {
            componentResults: [
              answered('judge-relevance', 0.9),
              answered('judge-unknown', 0.9),
            ],
          },
        }),
      ]),
    );
    expect(Object.keys(record?.states ?? {})).toEqual(['judge-relevance']);
    expect(
      collectRecords(file([entry({ response: { output: 'text' } })])),
    ).toEqual([]);
    expect(collectRecords(file([entry({ response: undefined })]))).toEqual([]);
  });

  it('refuses two runs with the same id, naming it', () => {
    expect(() =>
      collectRecords(
        file([entry({ repeatIndex: 1 }), entry({ repeatIndex: 1 })]),
      ),
    ).toThrow('two runs have the id lookup/known-model::m/one::1');
  });

  it('refuses what is no results file', () => {
    expect(() => collectRecords(null)).toThrow();
    expect(() => collectRecords({})).toThrow();
  });

  it('writes one record for each graded run, whatever their number', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 12 }), (errors) => {
        const entries = errors.map((error, index) =>
          entry({
            repeatIndex: index,
            ...(error ? { failureReason: 2, success: false } : {}),
          }),
        );
        expect(collectRecords(file(entries))).toHaveLength(
          errors.filter((error) => !error).length,
        );
      }),
    );
  });
});

describe('the collect command', () => {
  let dir: string;
  let stdout: string;
  let stderr: string;
  const io = {
    out: (text: string) => {
      stdout += text;
    },
    err: (text: string) => {
      stderr += text;
    },
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-calibrate-'));
    vi.stubEnv('HOME', dir);
    stdout = '';
    stderr = '';
  });
  afterEach(() => vi.unstubAllEnvs());

  const results = (
    content: unknown = file([entry(), entry({ repeatIndex: 4 })]),
  ) => {
    const target = path.join(dir, 'results.json');
    fs.writeFileSync(target, JSON.stringify(content));
    return target;
  };

  it('writes the records as a JSON array in the file it is given, and says how many', () => {
    const out = path.join(dir, 'records.json');
    expect(runCollect([results(), '--out', out], io)).toBe(0);
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(written).toHaveLength(2);
    expect(stdout).toBe(`2 records written to ${out}.\n`);
  });

  it('writes ~/jev-calibration-transcripts.json when no file is given', () => {
    vi.stubEnv('HOME', dir);
    expect(DEFAULT_CALIBRATION_FILE()).toBe(
      path.join(dir, 'jev-calibration-transcripts.json'),
    );
    expect(runCollect([results()], io)).toBe(0);
    expect(
      fs.existsSync(path.join(dir, 'jev-calibration-transcripts.json')),
    ).toBe(true);
  });

  it('leaves a file that exists as it was, and says so, unless --force is given', () => {
    const out = path.join(dir, 'records.json');
    fs.writeFileSync(out, '["paid answers"]');
    expect(runCollect([results(), '--out', out], io)).toBe(1);
    expect(stderr).toBe(
      `${out} exists and may hold paid answers. Give another --out, or --force to replace it.\n`,
    );
    expect(fs.readFileSync(out, 'utf8')).toBe('["paid answers"]');
    stderr = '';
    expect(runCollect([results(), '--out', out, '--force'], io)).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toHaveLength(2);
    // What it replaced is kept beside it.
    expect(fs.readFileSync(`${out}.bak`, 'utf8')).toBe('["paid answers"]');
  });

  it('never overwrites an earlier copy, and refuses a file another command holds', () => {
    const out = path.join(dir, 'twice.json');
    fs.writeFileSync(out, '["first"]');
    expect(runCollect([results(), '--out', out, '--force'], io)).toBe(0);
    fs.writeFileSync(out, '["second"]');
    expect(runCollect([results(), '--out', out, '--force'], io)).toBe(0);
    expect(fs.readFileSync(`${out}.bak`, 'utf8')).toBe('["first"]');
    expect(fs.readFileSync(`${out}.bak.2`, 'utf8')).toBe('["second"]');
    fs.writeFileSync(`${out}.lock`, '1\n');
    stderr = '';
    expect(runCollect([results(), '--out', out, '--force'], io)).toBe(1);
    expect(stderr).toContain('is in use by another calibration command');
    expect(fs.existsSync(`${out}.bak.3`)).toBe(false);
  });

  it('keeps no copy of a file that was not there, and says why when it cannot write', () => {
    const out = path.join(dir, 'new.json');
    expect(runCollect([results(), '--out', out], io)).toBe(0);
    expect(fs.existsSync(`${out}.bak`)).toBe(false);
    stderr = '';
    const missing = path.join(dir, 'no-such-dir', 'r.json');
    expect(runCollect([results(), '--out', missing], io)).toBe(1);
    expect(stderr).toContain(`Cannot write ${missing}: `);
  });

  it('exits 2 with the usage for a bad argument, and 1 for a results file it cannot read', () => {
    expect(runCollect([], io)).toBe(2);
    expect(stderr.startsWith('The results file is missing.\n')).toBe(true);
    expect(stderr).toContain(
      'Usage: calibrate collect <results.json> [--out <file>] [--force]',
    );
    stderr = '';
    expect(runCollect([results(), '--bogus'], io)).toBe(2);
    expect(runCollect([results(), '--out'], io)).toBe(2);
    expect(runCollect(['/nonexistent/results.json'], io)).toBe(1);
    expect(stderr).toMatch(
      /Cannot collect from \/nonexistent\/results\.json: /,
    );
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json');
    stderr = '';
    expect(runCollect([path.join(dir, 'bad.json')], io)).toBe(1);
    expect(stderr).toMatch(/Cannot collect from /);
  });
});
