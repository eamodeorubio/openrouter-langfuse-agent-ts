import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJev } from '../src/calibrate/jev.js';
import { readRecords } from '../src/calibrate/records.js';
import type { CalibrationRecord } from '../src/calibrate/types.js';
import { serveJev } from './jevServer.js';

const record = (
  id: string,
  over: Partial<CalibrationRecord> = {},
): CalibrationRecord => ({
  id,
  case: 'a/case',
  model: 'm/one',
  repeat: 0,
  prompt: 'Q',
  transcript: { toolCalls: [], answer: 'A' },
  states: {
    'judge-relevance': `state of ${id} for relevance`,
    'judge-grounding': `state of ${id} for grounding`,
  },
  jevAssertScores: {},
  ...over,
});

let dir: string;
let jev: Awaited<ReturnType<typeof serveJev>>;
const sink = () => {
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
const write = (records: CalibrationRecord[]) => {
  const file = path.join(dir, 'records.json');
  fs.writeFileSync(file, JSON.stringify(records));
  return file;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-jev-'));
  jev = await serveJev({ noul: 0.42 });
  vi.stubEnv('OPENROUTER_API_KEY', 'dummy-key-123');
  vi.stubEnv('EVAL_JUDGE_URL', jev.url);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await jev.close();
});

describe('the jev command', () => {
  it('scores each rubric of each control with the question of the rubric and the state of the record', async () => {
    const file = write([record('c1', { control: 'figure-invented' })]);
    const { io, seen } = sink();
    expect(await runJev(['--file', file], io)).toBe(0);
    expect(readRecords(file)[0]?.jevAssertScores).toEqual({
      'judge-relevance': 0.42,
      'judge-grounding': 0.42,
    });
    expect(jev.requests).toHaveLength(2);
    const byState = Object.fromEntries(
      jev.requests.map((r) => [r.body.state, r.body.questions]),
    );
    expect(byState['state of c1 for relevance']).toEqual({
      grade: {
        type: 'noul',
        instructions: 'Does the answer address the question that was asked?',
      },
    });
    expect(byState['state of c1 for grounding']).toEqual({
      grade: {
        type: 'noul',
        instructions:
          'Is every price, context size and capability in the answer given in the tool results?',
      },
    });
    expect(seen.out).toBe('2 rubrics scored, 0 failed, in 1 controls.\n');
  });

  it('leaves the runs alone, and the rubrics that already have a score, and sends nothing when there is nothing to score', async () => {
    const file = write([
      record('run', { jevAssertScores: { 'judge-relevance': 0.9 } }),
      record('c1', {
        control: 'answer-swapped',
        jevAssertScores: { 'judge-relevance': 0.1 },
      }),
    ]);
    expect(await runJev(['--file', file], sink().io)).toBe(0);
    expect(jev.requests).toHaveLength(1);
    expect(readRecords(file)[0]?.jevAssertScores).toEqual({
      'judge-relevance': 0.9,
    });
    expect(readRecords(file)[1]?.jevAssertScores).toEqual({
      'judge-relevance': 0.1,
      'judge-grounding': 0.42,
    });
    const again = sink();
    expect(await runJev(['--file', file], again.io)).toBe(0);
    expect(jev.requests).toHaveLength(1);
    expect(again.seen.out).toBe('0 rubrics scored, 0 failed, in 0 controls.\n');
  });

  it('leaves a rubric unscored and says so when Jev does not answer, and exits 1 so that a rerun finishes it', async () => {
    await jev.close();
    jev = await serveJev({ status: 500 });
    vi.stubEnv('EVAL_JUDGE_URL', jev.url);
    const file = write([record('c1', { control: 'figure-invented' })]);
    const { io, seen } = sink();
    expect(await runJev(['--file', file], io)).toBe(1);
    expect(readRecords(file)[0]?.jevAssertScores).toEqual({});
    expect(seen.out).toBe('0 rubrics scored, 2 failed, in 1 controls.\n');
    expect(seen.err).toMatch(
      /c1 judge-(relevance|grounding): TypeSafe API error/,
    );
  });

  it('leaves a state over the limit unscored, and scores the others', async () => {
    const file = write([
      record('c1', {
        control: 'tools-swapped',
        states: {
          'judge-relevance': 'short',
          'judge-grounding': 'x'.repeat(32_001),
        },
      }),
    ]);
    const { io, seen } = sink();
    expect(await runJev(['--file', file], io)).toBe(1);
    expect(readRecords(file)[0]?.jevAssertScores).toEqual({
      'judge-relevance': 0.42,
    });
    expect(seen.err).toContain('The state is too large: 32001 bytes');
  });

  it('stops before any request when there is no key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const file = write([record('c1', { control: 'figure-invented' })]);
    const { io, seen } = sink();
    expect(await runJev(['--file', file], io)).toBe(1);
    expect(seen.err).toBe(
      'OPENROUTER_API_KEY is not set, so nothing was scored.\n',
    );
    expect(jev.requests).toHaveLength(0);
  });

  it('exits 1 for a file it cannot read, 2 for a bad argument, and 2 for a bad --parallel', async () => {
    const { io, seen } = sink();
    expect(await runJev(['--file', '/nonexistent/records.json'], io)).toBe(1);
    expect(seen.err).toMatch(/Cannot read \/nonexistent\/records\.json: /);
    expect(await runJev(['--bogus'], io)).toBe(2);
    expect(seen.err).toContain(
      'Usage: calibrate jev [--file <file>] [--parallel <n>]',
    );
    for (const value of ['0', '-1', 'x', '1.5']) {
      expect(await runJev(['--parallel', value], io)).toBe(2);
    }
  });

  it('asks no more at once than --parallel says', async () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      record(`c${i}`, {
        control: 'figure-invented',
        states: { 'judge-relevance': `state ${i}` },
      }),
    );
    const file = write(records);
    expect(await runJev(['--file', file, '--parallel', '1'], sink().io)).toBe(
      0,
    );
    expect(jev.requests).toHaveLength(6);
  });
});

describe('the jev command with a grader that answers oddly', () => {
  const file = () => {
    const target = path.join(dir, 'odd.json');
    fs.writeFileSync(
      target,
      JSON.stringify([
        record('c1', {
          control: 'figure-invented',
          states: { 'judge-relevance': 'state one' },
        }),
        record('c2', {
          control: 'answer-swapped',
          states: { 'judge-relevance': 'state two' },
        }),
      ]),
    );
    return target;
  };

  it('says what the grader said when it gives no output, and that there was no score when it gives no number', async () => {
    const answers = [
      { error: 'The state is too large' },
      { output: { pass: true } },
    ];
    const grader = {
      callApi: async () => answers.shift() as never,
    };
    const { io, seen } = sink();
    expect(await runJev(['--file', file()], io, grader)).toBe(1);
    expect(seen.err).toContain('c1 judge-relevance: The state is too large');
    expect(seen.err).toContain('c2 judge-relevance: no score in the answer');
    expect(seen.out).toBe('0 rubrics scored, 2 failed, in 2 controls.\n');
  });

  it('hands the grader the question of the rubric as its prompt, and the state in the rubric context', async () => {
    const seen: { prompt: string; vars: unknown }[] = [];
    const grader = {
      callApi: async (prompt: string, context?: { vars?: unknown }) => {
        seen.push({ prompt, vars: context?.vars });
        return { output: { score: 0.3 } } as never;
      },
    };
    await runJev(['--file', file()], sink().io, grader);
    expect(seen[0]).toEqual({
      prompt: 'Does the answer address the question that was asked?',
      vars: {
        rubric: 'Does the answer address the question that was asked?',
        output: 'state one',
      },
    });
  });

  it('sends nothing, and says so, for a rubric it has no question for', async () => {
    let asked = 0;
    const grader = {
      callApi: async () => {
        asked += 1;
        return { output: { score: 0.3 } } as never;
      },
    };
    const target = path.join(dir, 'unknown.json');
    fs.writeFileSync(
      target,
      JSON.stringify([
        record('c1', {
          control: 'figure-invented',
          states: { 'judge-nonesuch': 's' },
        }),
      ]),
    );
    const { io, seen } = sink();
    expect(await runJev(['--file', target], io, grader)).toBe(1);
    expect(asked).toBe(0);
    expect(seen.err).toBe(
      'c1 judge-nonesuch: there is no question for this rubric\n',
    );
  });

  it('keeps what it scored when the grader fails on one call, and reports the call', async () => {
    let calls = 0;
    const grader = {
      callApi: async () => {
        calls += 1;
        if (calls === 2) throw new Error('the network went away');
        return { output: { score: 0.3 } } as never;
      },
    };
    const target = path.join(dir, 'throws.json');
    fs.writeFileSync(
      target,
      JSON.stringify([
        record('c1', {
          control: 'figure-invented',
          states: { 'judge-relevance': 'one', 'judge-grounding': 'two' },
        }),
      ]),
    );
    const { io, seen } = sink();
    expect(
      await runJev(['--file', target, '--parallel', '1'], io, grader),
    ).toBe(1);
    expect(seen.err).toContain('c1 judge-grounding: the network went away');
    expect(readRecords(target)[0]?.jevAssertScores).toEqual({
      'judge-relevance': 0.3,
    });
  });

  it('says why when the file cannot be written back', async () => {
    const target = path.join(dir, 'locked.json');
    fs.writeFileSync(
      target,
      JSON.stringify([record('c1', { control: 'figure-invented' })]),
    );
    fs.mkdirSync(`${target}.tmp`);
    const { io, seen } = sink();
    expect(await runJev(['--file', target], io)).toBe(1);
    expect(seen.err).toContain(`Cannot write ${target}: `);
    expect(seen.err).toContain(
      'The scores were NOT saved: see the error above.',
    );
  });

  it('writes the file while it works, after each batch, and not before', async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      record(`c${i}`, {
        control: 'figure-invented',
        states: { 'judge-relevance': `state ${i}` },
      }),
    );
    const target = path.join(dir, 'batches.json');
    fs.writeFileSync(target, JSON.stringify(records));
    const savedBefore: number[] = [];
    const grader = {
      callApi: async () => {
        savedBefore.push(
          readRecords(target).filter(
            (r) => r.jevAssertScores['judge-relevance'] !== undefined,
          ).length,
        );
        return { output: { score: 0.3 } } as never;
      },
    };
    expect(
      await runJev(['--file', target, '--parallel', '1'], sink().io, grader, 2),
    ).toBe(0);
    expect(savedBefore).toEqual([0, 0, 2, 2, 4]);
  });

  it('exits 1 when a save in the middle failed, even if the last one worked', async () => {
    const records = Array.from({ length: 3 }, (_, i) =>
      record(`c${i}`, {
        control: 'figure-invented',
        states: { 'judge-relevance': `state ${i}` },
      }),
    );
    const target = path.join(dir, 'midfail.json');
    fs.writeFileSync(target, JSON.stringify(records));
    fs.mkdirSync(`${target}.tmp`);
    let calls = 0;
    const grader = {
      callApi: async () => {
        calls += 1;
        // The third call frees the way, so only the save after the second fails.
        if (calls === 3) fs.rmSync(`${target}.tmp`, { recursive: true });
        return { output: { score: 0.3 } } as never;
      },
    };
    const { io, seen } = sink();
    expect(
      await runJev(['--file', target, '--parallel', '1'], io, grader, 2),
    ).toBe(1);
    expect(seen.err).toContain('The scores were NOT saved');
    expect(readRecords(target)[2]?.jevAssertScores).toEqual({
      'judge-relevance': 0.3,
    });
  });

  it('refuses a file another command holds, and lets go of it after', async () => {
    const target = write([record('c1', { control: 'figure-invented' })]);
    fs.writeFileSync(`${target}.lock`, '1\n');
    const { io, seen } = sink();
    expect(await runJev(['--file', target], io)).toBe(1);
    expect(seen.err).toContain('is in use by another calibration command');
    fs.rmSync(`${target}.lock`);
    await runJev(['--file', target], sink().io);
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it('asks no more at once than --parallel says, and four at once by default', async () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      record(`c${i}`, {
        control: 'figure-invented',
        states: { 'judge-relevance': `state ${i}` },
      }),
    );
    const target = path.join(dir, 'many.json');
    const run = async (extra: string[]) => {
      fs.writeFileSync(target, JSON.stringify(records));
      let active = 0;
      let most = 0;
      const grader = {
        callApi: async () => {
          active += 1;
          most = Math.max(most, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return { output: { score: 0.3 } } as never;
        },
      };
      await runJev(['--file', target, ...extra], sink().io, grader);
      return most;
    };
    expect(await run(['--parallel', '2'])).toBe(2);
    expect(await run([])).toBe(4);
  });

  it('counts the controls it scored, however many rubrics each has', async () => {
    const grader = {
      callApi: async () => ({ output: { score: 0.3 } }) as never,
    };
    const { io, seen } = sink();
    expect(await runJev(['--file', file()], io, grader)).toBe(0);
    expect(seen.out).toBe('2 rubrics scored, 0 failed, in 2 controls.\n');
  });

  it('refuses a --parallel with no value, and a --file with none, as arguments it does not expect', async () => {
    const { io, seen } = sink();
    expect(await runJev(['--parallel'], io)).toBe(2);
    expect(seen.err).toContain('Unexpected argument: --parallel');
    expect(await runJev(['--parallel', '0'], io)).toBe(2);
    expect(seen.err).toContain('--parallel takes a whole number from 1.');
  });
});
