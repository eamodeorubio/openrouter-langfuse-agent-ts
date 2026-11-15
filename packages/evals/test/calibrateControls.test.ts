import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeControls, runControls } from '../src/calibrate/controls.js';
import type { CalibrationRecord } from '../src/calibrate/types.js';
import { STATE_BUILDERS } from '../src/judge/state.js';

const call = (slug: string, output: string) => ({
  round: 1,
  name: 'get_model',
  arguments: JSON.stringify({ slug }),
  output,
  failed: false,
});

const record = (
  id: string,
  caseName: string,
  answer: string,
  toolCalls = [call('a/b', '{"id":"a/b"}')],
  rubrics = [
    'judge-grounding',
    'judge-relevance',
    'judge-usefulness',
    'judge-tool-usage',
  ],
): CalibrationRecord => {
  const output = {
    success: true,
    question: `Q of ${caseName}`,
    answer,
    toolCalls,
  };
  return {
    id,
    case: caseName,
    model: 'm/one',
    repeat: 0,
    prompt: `Q of ${caseName}`,
    transcript: { toolCalls, answer },
    states: Object.fromEntries(
      rubrics.map((r) => [r, STATE_BUILDERS[r]?.(output, {}) ?? '']),
    ),
    jevAssertScores: Object.fromEntries(rubrics.map((r) => [r, 0.9])),
  };
};

const A = record(
  'a::m/one::0',
  'a/case',
  'a/b costs $0.05 per million tokens.',
);
const B = record(
  'b::m/one::0',
  'b/case',
  'The model has 200,000 tokens of context.',
  [call('c/d', '{"id":"c/d"}')],
);
const C = record('c::m/one::0', 'c/case', 'It is cheap.', []);

const controlsOf = (records: CalibrationRecord[], kind: string) =>
  makeControls(records).filter((r) => r.control === kind);

describe('makeControls', () => {
  it('makes a control with the answer of another case, which should fail grounding, relevance and usefulness', () => {
    const control = controlsOf([A, B], 'answer-swapped').find(
      (r) => r.case === 'a/case',
    );
    expect(control).toBeDefined();
    expect(control?.id).toBe('a::m/one::0::answer-swapped');
    expect(control?.transcript.answer).toBe(B.transcript.answer);
    expect(control?.transcript.toolCalls).toEqual(A.transcript.toolCalls);
    expect(control?.prompt).toBe(A.prompt);
    expect(control?.expectedFail?.sort()).toEqual([
      'judge-grounding',
      'judge-relevance',
      'judge-usefulness',
    ]);
    const output = {
      success: true,
      question: A.prompt,
      answer: B.transcript.answer,
      toolCalls: A.transcript.toolCalls,
    };
    expect(control?.states['judge-relevance']).toBe(
      STATE_BUILDERS['judge-relevance']?.(output, {}),
    );
    expect(control?.jevAssertScores).toEqual({});
  });

  it('makes a control with an invented figure, which should fail grounding, and keeps the tool calls', () => {
    const control = controlsOf([A], 'figure-invented')[0];
    expect(control?.id).toBe('a::m/one::0::figure-invented');
    const answer = control?.transcript.answer ?? '';
    expect(answer).not.toBe(A.transcript.answer);
    expect(answer).toMatch(/^a\/b costs \$[\d.]+ per million tokens\.$/);
    expect(answer).not.toContain('$0.05');
    expect(control?.expectedFail).toEqual(['judge-grounding']);
    expect(control?.transcript.toolCalls).toEqual(A.transcript.toolCalls);
    // Only the rubric it should fail is asked.
    expect(Object.keys(control?.states ?? {})).toEqual(['judge-grounding']);
  });

  it('makes no control from a case that has no other case to borrow from, even with two runs of it', () => {
    const second = record('a2::m/one::0', 'a/case', 'A different answer');
    const made = makeControls([A, second]);
    expect(made.filter((r) => r.control !== 'figure-invented')).toEqual([]);
  });

  it('writes a figure of 1000 or more with no separator when it was written with none', () => {
    const control = controlsOf(
      [record('g::m/one::0', 'g/case', 'It has 2000 tokens.')],
      'figure-invented',
    )[0];
    expect(control?.transcript.answer).toBe('It has 14000 tokens.');
  });

  it('writes a comma-grouped figure in the same form', () => {
    const control = controlsOf([B], 'figure-invented')[0];
    expect(control?.transcript.answer).toMatch(
      /^The model has [\d,]+ tokens of context\.$/,
    );
    expect(control?.transcript.answer).not.toContain('200,000');
  });

  it('makes a control with the tool calls of another case, which should fail tool usage and grounding', () => {
    const control = controlsOf([A, B], 'tools-swapped').find(
      (r) => r.case === 'a/case',
    );
    expect(control?.transcript.toolCalls).toEqual(B.transcript.toolCalls);
    expect(control?.transcript.answer).toBe(A.transcript.answer);
    expect(control?.expectedFail?.sort()).toEqual([
      'judge-grounding',
      'judge-tool-usage',
    ]);
  });

  it('makes no control it cannot make: no figure, no other case, no tool calls to swap in, no rubric to fail', () => {
    expect(controlsOf([C], 'figure-invented')).toEqual([]);
    expect(makeControls([A])).toEqual(
      makeControls([A]).filter((r) => r.control === 'figure-invented'),
    );
    // Only a run with no tool calls of its own can borrow them from another case here.
    expect(controlsOf([A, C], 'tools-swapped').map((r) => r.id)).toEqual([
      'c::m/one::0::tools-swapped',
    ]);
    expect(controlsOf([C], 'tools-swapped')).toEqual([]);
    expect(controlsOf([A], 'tools-swapped')).toEqual([]);
    const only = record(
      'd::m/one::0',
      'd/case',
      'It costs $1.',
      [],
      ['judge-relevance'],
    );
    expect(controlsOf([only, A], 'figure-invented')).toEqual(
      controlsOf([A], 'figure-invented'),
    );
  });

  it('makes controls of the runs and never of a control', () => {
    const first = makeControls([A, B]);
    expect(first.every((r) => r.control !== undefined)).toBe(true);
    expect(makeControls([A, B, ...first]).map((r) => r.id)).toEqual(
      first.map((r) => r.id),
    );
  });

  it('is the same for the same records, whatever their order', () => {
    const forward = makeControls([A, B, C])
      .map((r) => r.id)
      .sort();
    const backward = makeControls([C, B, A])
      .map((r) => r.id)
      .sort();
    expect(backward).toEqual(forward);
    expect(
      makeControls([A, B, C])
        .map((r) => r.transcript.answer)
        .sort(),
    ).toEqual(
      makeControls([C, B, A])
        .map((r) => r.transcript.answer)
        .sort(),
    );
  });

  it('differs from its record, and expects to fail only rubrics the record was asked', () => {
    fc.assert(
      fc.property(fc.subarray([A, B, C]), (records) => {
        for (const control of makeControls(records)) {
          const source = records.find((r) => control.id.startsWith(r.id));
          expect(source).toBeDefined();
          expect(
            JSON.stringify(control.transcript) ===
              JSON.stringify(source?.transcript),
          ).toBe(false);
          for (const rubric of control.expectedFail ?? []) {
            expect(Object.keys(source?.states ?? {})).toContain(rubric);
          }
          expect(Object.keys(control.states).sort()).toEqual(
            [...(control.expectedFail ?? [])].sort(),
          );
        }
      }),
    );
  });
});

describe('the controls command', () => {
  const io = () => {
    const seen = { out: '', err: '' };
    return {
      seen,
      io: {
        out: (t: string) => {
          seen.out += t;
        },
        err: (t: string) => {
          seen.err += t;
        },
      },
    };
  };
  const filled = () => {
    const target = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'evals-controls-')),
      'records.json',
    );
    fs.writeFileSync(target, JSON.stringify([A, B]));
    return target;
  };

  it('adds the controls to the file, once, and says how many', () => {
    const target = filled();
    const { io: sink, seen } = io();
    expect(runControls(['--file', target], sink)).toBe(0);
    const added = JSON.parse(fs.readFileSync(target, 'utf8'));
    const controls = makeControls([A, B]);
    expect(added).toHaveLength(2 + controls.length);
    expect(seen.out).toBe(`${controls.length} controls added to ${target}.\n`);
    const again = io();
    expect(runControls(['--file', target], again.io)).toBe(0);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toHaveLength(
      2 + controls.length,
    );
    expect(again.seen.out).toBe(`0 controls added to ${target}.\n`);
  });

  it('refuses a file another command holds, and lets go of it after', () => {
    const target = filled();
    fs.writeFileSync(`${target}.lock`, '1\n');
    const held = io();
    expect(runControls(['--file', target], held.io)).toBe(1);
    expect(held.seen.err).toContain('is in use by another calibration command');
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toHaveLength(2);
    fs.rmSync(`${target}.lock`);
    expect(runControls(['--file', target], io().io)).toBe(0);
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it('exits 1 for a file it cannot read, and 2 for a bad argument', () => {
    const { io: sink, seen } = io();
    expect(runControls(['--file', '/nonexistent/records.json'], sink)).toBe(1);
    expect(seen.err).toMatch(/Cannot read \/nonexistent\/records\.json: /);
    expect(runControls(['--bogus'], sink)).toBe(2);
    expect(seen.err).toContain('Usage: calibrate controls [--file <file>]');
  });
});

describe('the figure of a control', () => {
  const answered = (answer: string) =>
    controlsOf([record('f::m/one::0', 'f/case', answer)], 'figure-invented')[0]
      ?.transcript.answer;

  it.each([
    [
      'a/b costs $0.05 per million tokens.',
      'a/b costs $0.35 per million tokens.',
    ],
    ['It costs 10.50 USD.', 'It costs 73.50 USD.'],
    ['It costs 20 USD.', 'It costs 140 USD.'],
    ['It has 200,000 tokens.', 'It has 1,400,000 tokens.'],
    ['It costs $1,234.50.', 'It costs $8,641.50.'],
    ['It costs $0 now.', 'It costs $7 now.'],
    ['Use openai/gpt-oss-20b for 5 USD.', 'Use openai/gpt-oss-20b for 35 USD.'],
  ])('writes %j as %j', (before, after) => {
    expect(answered(before)).toBe(after);
  });

  it('leaves an answer with no figure of its own without a control', () => {
    expect(answered('Use gpt-oss-20b, it is v2-fast.')).toBeUndefined();
  });
});

describe('the borrowing of a control', () => {
  const alpha = record('a::m/one::0', 'a/case', 'Alpha answer', [
    call('a/x', '{}'),
  ]);
  const beta0 = record('b::m/one::0', 'b/case', 'Beta zero', [
    call('b/x', '{}'),
  ]);
  const beta1 = record('b::m/one::1', 'b/case', 'Beta one', [
    call('b/y', '{}'),
  ]);
  const gamma = record('c::m/one::0', 'c/case', 'Gamma answer', [
    call('c/x', '{}'),
  ]);

  const answerOf = (id: string, kind: string, records: CalibrationRecord[]) =>
    makeControls(records).find((r) => r.id === `${id}::${kind}`)?.transcript;

  it('borrows from the first run, by id, of the next case by name, whatever the order of the runs', () => {
    for (const order of [
      [alpha, beta0, beta1, gamma],
      [gamma, beta1, beta0, alpha],
    ]) {
      expect(answerOf(alpha.id, 'answer-swapped', order)?.answer).toBe(
        'Beta zero',
      );
      expect(answerOf(alpha.id, 'tools-swapped', order)?.toolCalls).toEqual(
        beta0.transcript.toolCalls,
      );
      expect(answerOf(beta0.id, 'answer-swapped', order)?.answer).toBe(
        'Gamma answer',
      );
    }
  });

  it('comes round to the first case after the last one', () => {
    expect(
      answerOf(gamma.id, 'answer-swapped', [alpha, beta0, gamma])?.answer,
    ).toBe('Alpha answer');
  });

  it('makes no answer-swapped control when the other answer is the same as its own', () => {
    const twin = record('t::m/one::0', 't/case', 'Alpha answer');
    expect(
      makeControls([alpha, twin]).filter(
        (r) => r.control === 'answer-swapped' && r.case === 'a/case',
      ),
    ).toEqual([]);
  });

  it('drops a rubric that has no builder from the states of a control', () => {
    const odd = {
      ...alpha,
      states: { ...alpha.states, 'judge-unknown': 'state' },
    };
    const [made] = makeControls([odd, beta0]).filter(
      (r) => r.control === 'figure-invented' || r.control === 'answer-swapped',
    );
    expect(Object.keys(made?.states ?? {})).not.toContain('judge-unknown');
  });
});

describe('the controls command arguments', () => {
  it('refuses an argument it does not know, naming it, with the usage', () => {
    const seen = { err: '' };
    expect(
      runControls(['--file'], {
        out: () => {},
        err: (t) => {
          seen.err += t;
        },
      }),
    ).toBe(2);
    expect(seen.err).toBe(
      'Unexpected argument: --file\nUsage: calibrate controls [--file <file>]\n',
    );
  });
});

describe('the order of the cases a control borrows through', () => {
  it('goes by the names of the cases, and not by the ids of the runs', () => {
    const first = record('x1::m/one::0', 'a/case', 'Answer of a');
    const second = record('y1::m/one::0', 'c/case', 'Answer of c');
    const third = record('z1::m/one::0', 'b/case', 'Answer of b');
    const made = makeControls([first, second, third]);
    expect(
      made.find((r) => r.id === 'x1::m/one::0::answer-swapped')?.transcript
        .answer,
    ).toBe('Answer of b');
  });
});

describe('which figure a control invents', () => {
  const answered = (answer: string) =>
    controlsOf([record('f::m/one::0', 'f/case', answer)], 'figure-invented')[0]
      ?.transcript.answer;

  it('takes a price or a size, and passes over a list number, a year and a count of models', () => {
    expect(answered('1. Use a/b: it costs $0.05 per million tokens.')).toBe(
      '1. Use a/b: it costs $0.35 per million tokens.',
    );
    expect(answered('In 2026 it costs 3 USD.')).toBe(
      'In 2026 it costs 21 USD.',
    );
    expect(answered('Top 3 models have 8192 tokens of context.')).toBe(
      'Top 3 models have 57344 tokens of context.',
    );
    expect(answered('It is 5/M for input.')).toBe('It is 35/M for input.');
    expect(answered('It is 5 per million tokens.')).toBe(
      'It is 35 per million tokens.',
    );
  });

  it('makes no control from an answer whose only numbers are not prices or sizes', () => {
    expect(answered('1. Use a/b, the top 3 models, in 2026.')).toBeUndefined();
  });

  it('replaces the figure where it stands, and not the first place its text appears', () => {
    expect(answered('GPT-5 costs 5 USD.')).toBe('GPT-5 costs 35 USD.');
  });
});

describe('what a control keeps of its run', () => {
  it('does not keep the answers of Opus or the scores of Jev about the run', () => {
    const judged: CalibrationRecord = {
      ...A,
      opusScore: { 'judge-relevance': 'yes' },
      opusReason: { 'judge-relevance': 'fine' },
      jevAssertScores: { 'judge-relevance': 0.9 },
    };
    const [control] = makeControls([judged]).filter(
      (r) => r.control === 'figure-invented',
    );
    expect(control?.opusScore).toBeUndefined();
    expect(control?.opusReason).toBeUndefined();
    expect(control?.jevAssertScores).toEqual({});
  });
});
