import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOpus } from '../src/calibrate/opus.js';
import { readRecords } from '../src/calibrate/records.js';
import type { CalibrationRecord } from '../src/calibrate/types.js';
import { makeFakeClaude } from './fakePnpm.js';

const record = (
  id: string,
  states: Record<string, string>,
  over: Partial<CalibrationRecord> = {},
): CalibrationRecord => ({
  id,
  case: 'a/case',
  model: 'm/one',
  repeat: 0,
  prompt: 'Q',
  transcript: { toolCalls: [], answer: 'A' },
  states,
  jevAssertScores: {},
  ...over,
});

let dir: string;
let log: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-opus-'));
  log = path.join(dir, 'calls.log');
  vi.stubEnv('EVAL_CLAUDE', makeFakeClaude());
  vi.stubEnv('FAKE_CLAUDE_LOG', log);
});
afterEach(() => vi.unstubAllEnvs());

const write = (records: CalibrationRecord[]) => {
  const file = path.join(dir, 'records.json');
  fs.writeFileSync(file, JSON.stringify(records));
  return file;
};
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
const calls = (): { args: string[]; prompt: string; cwd: string }[] =>
  fs.existsSync(log)
    ? fs
        .readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

describe('the opus command', () => {
  it('asks Opus 5.5 each rubric of each record, with high effort, no tools and no session', async () => {
    const file = write([
      record('r1', {
        'judge-relevance': 'State of r1 [[no]]',
        'judge-grounding': 'State of r1',
      }),
    ]);
    const { io, seen } = sink();
    expect(await runOpus(['--file', file], io)).toBe(0);
    expect(calls()).toHaveLength(2);
    const [first] = calls();
    const args = first?.args ?? [];
    expect(args.slice(0, 1)).toEqual(['-p']);
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1] ?? '{}');
    expect(schema.properties.verdict.enum).toEqual(['yes', 'no', 'ambiguous']);
    expect(args).not.toContain('--bare');
    const [record1] = readRecords(file);
    expect(record1?.opusScore).toEqual({
      'judge-relevance': 'no',
      'judge-grounding': 'yes',
    });
    expect(record1?.opusReason?.['judge-relevance']).toBe('The fake says no.');
    expect(seen.out).toMatch(/^2 rubrics judged, 0 failed, in 1 records\./);
  });

  it('puts the exact question of the rubric and the exact state in the prompt', async () => {
    const file = write([
      record('r1', { 'judge-relevance': 'THE STATE\nof the run' }),
    ]);
    await runOpus(['--file', file], sink().io);
    const prompt = calls()[0]?.prompt ?? '';
    expect(prompt).toContain(
      'Does the answer address the question that was asked?',
    );
    expect(prompt).toContain('THE STATE\nof the run');
    expect(prompt).toContain('yes, no or ambiguous');
  });

  it('starts claude in an empty directory, so that no project instructions steer the judge', async () => {
    const file = write([record('r1', { 'judge-relevance': 's' })]);
    await runOpus(['--file', file], sink().io);
    const cwd = calls()[0]?.cwd ?? '';
    expect(path.resolve(cwd)).not.toBe(path.resolve(process.cwd()));
    expect(fs.existsSync(cwd)).toBe(false);
    expect(path.basename(cwd)).toMatch(/^evals-opus-cwd-/);
  });

  it('records ambiguous, and does not ask a rubric again that has its answer', async () => {
    const file = write([
      record(
        'r1',
        { 'judge-relevance': 's [[amb]]', 'judge-grounding': 's' },
        {
          opusScore: { 'judge-grounding': 'no' },
          opusReason: { 'judge-grounding': 'x' },
        },
      ),
    ]);
    expect(await runOpus(['--file', file], sink().io)).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(readRecords(file)[0]?.opusScore).toEqual({
      'judge-grounding': 'no',
      'judge-relevance': 'ambiguous',
    });
    const again = sink();
    expect(await runOpus(['--file', file], again.io)).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(again.seen.out).toMatch(
      /^0 rubrics judged, 0 failed, in 0 records\./,
    );
  });

  it('leaves a field empty and reports a call that fails, a result that is an error, and an answer that is no verdict, and exits 1', async () => {
    const file = write([
      record('crash', { 'judge-relevance': '[[crash]]' }),
      record('error', { 'judge-relevance': '[[error]]' }),
      record('garbage', { 'judge-relevance': '[[garbage]]' }),
      record('verdict', { 'judge-relevance': '[[badverdict]]' }),
      record('fine', { 'judge-relevance': 'ok' }),
    ]);
    const { io, seen } = sink();
    expect(await runOpus(['--file', file], io)).toBe(1);
    const records = readRecords(file);
    expect(records.map((r) => r.opusScore?.['judge-relevance'])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'yes',
    ]);
    expect(seen.err).toContain(
      'crash judge-relevance: claude exited with code 1',
    );
    expect(seen.err).toContain(
      'error judge-relevance: claude answered with an error: error_max_turns',
    );
    expect(seen.err).toContain(
      'garbage judge-relevance: claude printed no JSON',
    );
    expect(seen.err).toContain(
      'verdict judge-relevance: claude gave no verdict',
    );
    expect(seen.out).toMatch(/^1 rubrics judged, 4 failed, in 5 records\./);
  });

  it('stops after --max-calls calls, so that a pilot costs what it says', async () => {
    const file = write(
      Array.from({ length: 5 }, (_, i) =>
        record(`r${i}`, { 'judge-relevance': `s${i}` }),
      ),
    );
    expect(await runOpus(['--file', file, '--max-calls', '2'], sink().io)).toBe(
      0,
    );
    expect(calls()).toHaveLength(2);
    expect(
      readRecords(file).filter((r) => r.opusScore !== undefined),
    ).toHaveLength(2);
  });

  it('adds up what the calls cost, when claude says', async () => {
    const file = write([record('r1', { 'judge-relevance': 's' })]);
    const { io, seen } = sink();
    await runOpus(['--file', file], io);
    expect(seen.out).toContain('about $0.01');
  });

  it('exits 1 for a file it cannot read, and 2 for a bad argument', async () => {
    const { io, seen } = sink();
    expect(await runOpus(['--file', '/nonexistent/records.json'], io)).toBe(1);
    expect(seen.err).toMatch(/Cannot read \/nonexistent\/records\.json: /);
    expect(await runOpus(['--bogus'], io)).toBe(2);
    expect(seen.err).toContain(
      'Usage: calibrate opus [--file <file>] [--parallel <n>] [--max-calls <n>]',
    );
    for (const flag of ['--parallel', '--max-calls']) {
      for (const value of ['0', '-1', 'x', '1.5']) {
        expect(await runOpus([flag, value], io)).toBe(2);
      }
    }
  });

  it('asks no more at once than --parallel says', async () => {
    vi.stubEnv('FAKE_CLAUDE_SLEEP', '150');
    const file = write(
      Array.from({ length: 4 }, (_, i) =>
        record(`r${i}`, { 'judge-relevance': `s${i}` }),
      ),
    );
    const started = Date.now();
    expect(await runOpus(['--file', file, '--parallel', '4'], sink().io)).toBe(
      0,
    );
    const parallelTime = Date.now() - started;
    const again = write(
      Array.from({ length: 4 }, (_, i) =>
        record(`q${i}`, { 'judge-relevance': `s${i}` }),
      ),
    );
    const serialStart = Date.now();
    expect(await runOpus(['--file', again, '--parallel', '1'], sink().io)).toBe(
      0,
    );
    expect(Date.now() - serialStart).toBeGreaterThan(parallelTime);
  });
});

describe('the calls of the opus command', () => {
  const sink2 = () => {
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
  const fileOf = (records: CalibrationRecord[]) => {
    const file = path.join(dir, 'records.json');
    fs.writeFileSync(file, JSON.stringify(records));
    return file;
  };
  const logged = () =>
    fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            args: string[];
            prompt: string;
            hasOpenRouterKey: boolean;
            answered?: number;
          },
      );

  it('sends the prompt on the input of claude, and not as an argument, so that a large state fits', async () => {
    const big = 'x'.repeat(300_000);
    await runOpus(
      ['--file', fileOf([record('r1', { 'judge-relevance': big })])],
      sink2().io,
    );
    const call = logged()[0];
    expect(call?.prompt).toContain(big);
    expect(call?.args.some((arg) => arg.includes('xxxxxxxx'))).toBe(false);
  });

  it('leaves the key of OpenRouter out of the environment of claude, which does not need it', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'dummy-key-123');
    await runOpus(
      ['--file', fileOf([record('r1', { 'judge-relevance': 's' })])],
      sink2().io,
    );
    expect(logged()[0]?.hasOpenRouterKey).toBe(false);
  });

  it('keeps the variables of its own that only look like the ones it hides', async () => {
    vi.stubEnv('XOPENROUTER_THING', 'kept');
    vi.stubEnv('OPENROUTER_API_KEY', 'dummy-key-123');
    vi.stubEnv('OTEL_SERVICE_NAME', 'x');
    await runOpus(
      ['--file', fileOf([record('r1', { 'judge-relevance': 's' })])],
      sink2().io,
    );
    expect((logged()[0] as unknown as { keys: string[] }).keys).toEqual([
      'XOPENROUTER_THING',
    ]);
  });

  it('says a call was stopped by a signal when it was not a timeout', async () => {
    const { io, seen } = sink2();
    const file = fileOf([record('r1', { 'judge-relevance': '[[sigterm]]' })]);
    expect(await runOpus(['--file', file], io)).toBe(1);
    expect(seen.err).toBe(
      'r1 judge-relevance: claude was stopped by SIGTERM\n',
    );
  });

  it('kills a call that takes too long, and reports it as the failure of that one rubric', async () => {
    vi.stubEnv('FAKE_CLAUDE_SLEEP', '5000');
    const file = fileOf([record('r1', { 'judge-relevance': 's' })]);
    const { io, seen } = sink2();
    expect(await runOpus(['--file', file], io, { timeoutMs: 300 })).toBe(1);
    expect(seen.err).toBe('r1 judge-relevance: claude timed out after 0.3 s\n');
  });

  it('gives the judge its own system prompt, and no other', async () => {
    await runOpus(
      ['--file', fileOf([record('r1', { 'judge-relevance': 's' })])],
      sink2().io,
    );
    const args = logged()[0]?.args ?? [];
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(
      'You are the reference judge of a calibration. You answer one yes/no question about a text, and nothing else.',
    );
  });

  it('starts claude from the path when EVAL_CLAUDE names none', async () => {
    const dir2 = path.dirname(makeFakeClaude());
    vi.stubEnv('EVAL_CLAUDE', undefined as never);
    delete process.env.EVAL_CLAUDE;
    vi.stubEnv('PATH', `${dir2}${path.delimiter}${process.env.PATH ?? ''}`);
    const file = fileOf([record('r1', { 'judge-relevance': 's' })]);
    expect(await runOpus(['--file', file], sink2().io)).toBe(0);
    expect(logged()).toHaveLength(1);
  });

  it('says what claude wrote when it fails, without the line ends, and says when it wrote nothing', async () => {
    const file = fileOf([
      record('loud', { 'judge-relevance': '[[crash]]' }),
      record('quiet', { 'judge-relevance': '[[silentcrash]]' }),
    ]);
    const { io, seen } = sink2();
    await runOpus(['--file', file, '--parallel', '1'], io);
    expect(seen.err.split('\n')).toContain(
      'loud judge-relevance: claude exited with code 1: claude: something broke',
    );
    expect(seen.err.split('\n')).toContain(
      'quiet judge-relevance: claude exited with code 1',
    );
  });

  it('says what claude printed when it fails with nothing on its error output', async () => {
    const file = fileOf([
      record('limit', { 'judge-relevance': '[[jsonfail]]' }),
    ]);
    const { io, seen } = sink2();
    await runOpus(['--file', file], io);
    expect(seen.err).toBe(
      'limit judge-relevance: claude exited with code 1: You have hit your limit\n',
    );
  });

  it('trims what claude printed and keeps its first 300 characters', async () => {
    const file = fileOf([
      record('long', { 'judge-relevance': '[[longfail]]' }),
    ]);
    const { io, seen } = sink2();
    await runOpus(['--file', file], io);
    expect(seen.err).toBe(
      `long judge-relevance: claude exited with code 1: ${'x'.repeat(300)}\n`,
    );
  });

  it('says that claude did not start, with the reason', async () => {
    vi.stubEnv('EVAL_CLAUDE', '/nonexistent/claude');
    const { io, seen } = sink2();
    await runOpus(
      ['--file', fileOf([record('r1', { 'judge-relevance': 's' })])],
      io,
    );
    expect(seen.err).toBe(
      'r1 judge-relevance: claude did not start: spawn /nonexistent/claude ENOENT\n',
    );
  });

  it('refuses a verdict that is no text, and records an empty reason when none was given', async () => {
    const file = fileOf([
      record('num', { 'judge-relevance': '[[numverdict]]' }),
      record('bare', { 'judge-relevance': '[[noreason]]' }),
    ]);
    const { io, seen } = sink2();
    expect(await runOpus(['--file', file], io)).toBe(1);
    expect(seen.err).toContain('num judge-relevance: claude gave no verdict');
    const [, bare] = readRecords(file);
    expect(bare?.opusScore).toEqual({ 'judge-relevance': 'yes' });
    expect(bare?.opusReason).toEqual({ 'judge-relevance': '' });
  });

  it('writes the file while it works, after each batch, and not before', async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      record(`r${i}`, { 'judge-relevance': `s${i}` }),
    );
    const file = fileOf(records);
    vi.stubEnv('FAKE_CLAUDE_FILE', file);
    await runOpus(['--file', file, '--parallel', '1'], sink2().io, {
      saveEvery: 2,
    });
    expect(logged().map((call) => call.answered)).toEqual([0, 0, 2, 2, 4]);
  });

  it('refuses a file another command holds, and lets go of it after', async () => {
    const file = fileOf([record('r1', { 'judge-relevance': 's' })]);
    fs.writeFileSync(`${file}.lock`, '1\n');
    const held = sink2();
    expect(await runOpus(['--file', file], held.io)).toBe(1);
    expect(held.seen.err).toContain('is in use by another calibration command');
    fs.rmSync(`${file}.lock`);
    expect(await runOpus(['--file', file], sink2().io)).toBe(0);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it('exits 1 and says the answers were not saved when the file cannot be written', async () => {
    const file = fileOf([record('r1', { 'judge-relevance': 's' })]);
    fs.mkdirSync(`${file}.tmp`);
    const { io, seen } = sink2();
    expect(await runOpus(['--file', file], io)).toBe(1);
    expect(seen.err).toContain(
      'The answers were NOT saved: see the error above.',
    );
  });

  it('exits 1 when a save in the middle failed, even if the last one worked', async () => {
    const records = [
      record('r0', { 'judge-relevance': 's0' }),
      record('r1', { 'judge-relevance': 's1' }),
      record('r2', { 'judge-relevance': '[[unblock]]' }),
    ];
    const file = fileOf(records);
    fs.mkdirSync(`${file}.tmp`);
    vi.stubEnv('FAKE_CLAUDE_BLOCK', `${file}.tmp`);
    const { io, seen } = sink2();
    expect(
      await runOpus(['--file', file, '--parallel', '1'], io, { saveEvery: 2 }),
    ).toBe(1);
    expect(seen.err).toContain('The answers were NOT saved');
    expect(readRecords(file).every((r) => r.opusScore !== undefined)).toBe(
      true,
    );
  });

  it('writes nothing mid-run with the default batch, for a few records', async () => {
    const records = Array.from({ length: 3 }, (_, i) =>
      record(`r${i}`, { 'judge-relevance': `s${i}` }),
    );
    const file = fileOf(records);
    vi.stubEnv('FAKE_CLAUDE_FILE', file);
    await runOpus(['--file', file, '--parallel', '1'], sink2().io);
    expect(logged().map((call) => call.answered)).toEqual([0, 0, 0]);
  });

  it('says nothing of cost when claude reports none, or none above 0', async () => {
    for (const env of ['FAKE_CLAUDE_NOCOST', 'FAKE_CLAUDE_ZEROCOST']) {
      vi.stubEnv(env, '1');
      const { io, seen } = sink2();
      await runOpus(
        ['--file', fileOf([record(`r${env}`, { 'judge-relevance': 's' })])],
        io,
      );
      expect(seen.out).toBe('1 rubrics judged, 0 failed, in 1 records.\n');
      vi.unstubAllEnvs();
      vi.stubEnv('EVAL_CLAUDE', makeFakeClaude());
      vi.stubEnv('FAKE_CLAUDE_LOG', log);
    }
  });

  it('asks nothing, and says so, for a rubric it has no question for', async () => {
    const { io, seen } = sink2();
    const file = fileOf([record('r1', { 'judge-nonesuch': 'a state' })]);
    expect(await runOpus(['--file', file], io)).toBe(1);
    expect(fs.existsSync(log)).toBe(false);
    expect(seen.err).toBe(
      'r1 judge-nonesuch: there is no question for this rubric\n',
    );
    expect(seen.out).toBe('0 rubrics judged, 1 failed, in 0 records.\n');
  });

  it('says why when the file cannot be written back', async () => {
    const file = fileOf([record('r1', { 'judge-relevance': 's' })]);
    fs.mkdirSync(`${file}.tmp`);
    const { io, seen } = sink2();
    await runOpus(['--file', file], io);
    expect(seen.err).toContain(`Cannot write ${file}: `);
  });

  it('refuses a --max-calls with no value, as an argument it does not expect', async () => {
    const { io, seen } = sink2();
    expect(await runOpus(['--max-calls'], io)).toBe(2);
    expect(seen.err).toContain('Unexpected argument: --max-calls');
    expect(await runOpus(['--max-calls', '0'], io)).toBe(2);
    expect(seen.err).toContain('--max-calls takes a whole number from 1.');
  });
});

describe('the message of a call that fails', () => {
  it('is one line, without the line end claude wrote', async () => {
    const file = path.join(dir, 'records.json');
    fs.writeFileSync(
      file,
      JSON.stringify([record('r1', { 'judge-relevance': '[[crash]]' })]),
    );
    const seen = { err: '' };
    await runOpus(['--file', file], {
      out: () => {},
      err: (text) => {
        seen.err += text;
      },
    });
    expect(seen.err).toBe(
      'r1 judge-relevance: claude exited with code 1: claude: something broke\n',
    );
  });
});
