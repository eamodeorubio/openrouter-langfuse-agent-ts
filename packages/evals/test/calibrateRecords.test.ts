import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backUp,
  lock,
  readOrReport,
  readRecords,
  writeOrReport,
  writeRecords,
} from '../src/calibrate/records.js';
import type { CalibrationRecord } from '../src/calibrate/types.js';

const record = (id = 'r'): CalibrationRecord => ({
  id,
  case: 'c',
  model: 'm',
  repeat: 0,
  prompt: 'q',
  transcript: { toolCalls: [], answer: 'a' },
  states: {},
  jevAssertScores: {},
});

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'evals-records-'));
const sink = () => {
  const seen = { err: '' };
  return {
    seen,
    io: {
      out: () => {},
      err: (t: string) => {
        seen.err += t;
      },
    },
  };
};

describe('writeRecords', () => {
  it('writes the records as a JSON array that readRecords reads back', () => {
    const file = path.join(dir(), 'r.json');
    writeRecords(file, [record('a'), record('b')]);
    expect(readRecords(file).map((r) => r.id)).toEqual(['a', 'b']);
    expect(fs.readFileSync(file, 'utf8').endsWith(']\n')).toBe(true);
  });

  it('replaces the file in one step, leaves no file of its own behind, and lets only the owner read a new one', () => {
    const where = dir();
    const file = path.join(where, 'r.json');
    writeRecords(file, [record('a')]);
    expect(fs.readdirSync(where)).toEqual(['r.json']);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    writeRecords(file, [record('b')]);
    expect(readRecords(file).map((r) => r.id)).toEqual(['b']);
    expect(fs.readdirSync(where)).toEqual(['r.json']);
  });

  it('leaves the old file whole when the new one cannot be written', () => {
    const where = dir();
    const file = path.join(where, 'r.json');
    writeRecords(file, [record('a')]);
    fs.mkdirSync(`${file}.tmp`);
    expect(() => writeRecords(file, [record('b')])).toThrow();
    expect(readRecords(file).map((r) => r.id)).toEqual(['a']);
  });
});

describe('readRecords', () => {
  const write = (content: unknown) => {
    const file = path.join(dir(), 'r.json');
    fs.writeFileSync(file, JSON.stringify(content));
    return file;
  };

  it('refuses what holds no array', () => {
    expect(() => readRecords(write({}))).toThrow(
      'the file holds no array of records',
    );
  });

  it.each([
    ['is not an object', 3],
    ['has no id', { ...record(), id: '' }],
    ['has no id', { ...record(), id: 3 }],
    ['has no states', { ...record(), states: undefined }],
    ['has no jevAssertScores', { ...record(), jevAssertScores: [] }],
    ['has no transcript', { ...record(), transcript: null }],
    [
      'has no transcript.answer',
      { ...record(), transcript: { toolCalls: [], answer: 3 } },
    ],
    [
      'has no transcript.toolCalls',
      { ...record(), transcript: { toolCalls: 'none', answer: 'a' } },
    ],
    [
      'has a state that is not text',
      { ...record(), states: { r: 'ok', s: 3 } },
    ],
    [
      'has a score that is not a number',
      { ...record(), jevAssertScores: { r: 0.5, s: 'high' } },
    ],
    [
      'has an opusScore that is not yes, no or ambiguous',
      { ...record(), opusScore: { r: 'yes', s: 'maybe' } },
    ],
    [
      'has an opusScore that is not yes, no or ambiguous',
      { ...record(), opusScore: 'yes' },
    ],
    ['has a control that is not known', { ...record(), control: 'made-up' }],
  ])('names the record that %s', (problem, bad) => {
    expect(() => readRecords(write([record('ok'), bad]))).toThrow(
      `record 2 ${problem}`,
    );
  });
});

describe('a record that is whole', () => {
  it('is accepted with every optional field, and with none', () => {
    const file = path.join(dir(), 'r.json');
    const full = {
      ...record('full'),
      opusScore: { r: 'yes', s: 'no', t: 'ambiguous' },
      control: 'tools-swapped',
    };
    fs.writeFileSync(file, JSON.stringify([record('plain'), full]));
    expect(readRecords(file)).toHaveLength(2);
  });
});

describe('the copy of a file', () => {
  it('goes beside it, readable by its owner only, and never over an earlier one', () => {
    const file = path.join(dir(), 'r.json');
    fs.writeFileSync(file, 'one');
    const copies = [1, 2, 3].map((n) => {
      fs.writeFileSync(file, `content ${n}`);
      return backUp(file);
    });
    expect(copies).toEqual([`${file}.bak`, `${file}.bak.2`, `${file}.bak.3`]);
    expect(copies.map((c) => fs.readFileSync(c, 'utf8'))).toEqual([
      'content 1',
      'content 2',
      'content 3',
    ]);
    for (const copy of copies) {
      expect(fs.statSync(copy).mode & 0o777).toBe(0o600);
    }
  });
});

describe('what a command says when it cannot read or write', () => {
  it('names the file and the reason, and gives nothing back', () => {
    const { io, seen } = sink();
    expect(readOrReport('/nonexistent/r.json', io)).toBeUndefined();
    expect(seen.err).toMatch(/^Cannot read \/nonexistent\/r\.json: /);
    const bad = sink();
    expect(writeOrReport('/nonexistent/dir/r.json', [record()], bad.io)).toBe(
      false,
    );
    expect(bad.seen.err).toMatch(/^Cannot write \/nonexistent\/dir\/r\.json: /);
    const fine = sink();
    expect(writeOrReport(path.join(dir(), 'r.json'), [record()], fine.io)).toBe(
      true,
    );
    expect(fine.seen.err).toBe('');
  });
});

describe('the lock of a file', () => {
  it('is taken once, refused while held, and let go of', () => {
    const file = path.join(dir(), 'r.json');
    const first = sink();
    const release = lock(file, first.io) as () => void;
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe(`${process.pid}\n`);
    const second = sink();
    expect(lock(file, second.io)).toBeUndefined();
    expect(second.seen.err).toBe(
      `${file} is in use by another calibration command: ${file}.lock exists. If none is running, remove it.\n`,
    );
    release();
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    // Letting go of a lock that is already gone is no error.
    expect(() => release()).not.toThrow();
    expect(lock(file, sink().io)).toBeTypeOf('function');
  });

  it('does not block a file in a folder that is not there: the read says why', () => {
    const { io, seen } = sink();
    const release = lock('/nonexistent/dir/r.json', io);
    expect(release).toBeTypeOf('function');
    expect(() => (release as () => void)()).not.toThrow();
    expect(seen.err).toBe('');
  });
});
