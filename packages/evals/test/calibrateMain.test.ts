import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAnalyze } from '../src/calibrate/analyze.js';
import { dispatch, SUBCOMMANDS } from '../src/calibrate/index.js';
import type { CalibrationRecord } from '../src/calibrate/types.js';

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

describe('the calibrate command', () => {
  it('has the five subcommands, in the order of the steps', () => {
    expect(SUBCOMMANDS).toEqual([
      'collect',
      'controls',
      'jev',
      'opus',
      'analyze',
    ]);
  });

  it('prints the usage and exits 2 without a subcommand, or with one it does not know', async () => {
    for (const argv of [[], ['bogus'], ['--help']]) {
      const { io, seen } = sink();
      expect(await dispatch(argv, io)).toBe(2);
      expect(seen.err).toBe(
        'Usage: calibrate <collect|controls|jev|opus|analyze> [options]\n',
      );
    }
  });

  it('does not take a name from the prototype of the table of commands for a subcommand', async () => {
    for (const name of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      const { io, seen } = sink();
      expect(await dispatch([name], io)).toBe(2);
      expect(seen.err).toContain('Usage: calibrate <');
    }
  });

  it('hands the rest of the arguments to the subcommand', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-main-'));
    const file = path.join(dir, 'records.json');
    fs.writeFileSync(file, '[]');
    const { io, seen } = sink();
    expect(await dispatch(['analyze', '--file', file], io)).toBe(0);
    expect(seen.out).toBe('No rubric has an answer from Opus yet.\n');
    expect(await dispatch(['controls', '--file', file], io)).toBe(0);
    expect(seen.out).toContain('0 controls added to');
    const bad = sink();
    expect(await dispatch(['analyze', '--bogus'], bad.io)).toBe(2);
    expect(bad.seen.err).toContain('Usage: calibrate analyze');
  });
});

describe('the analyze command', () => {
  it('prints the analysis of a file, and fails with a message for a file it cannot read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-analyze-'));
    const file = path.join(dir, 'records.json');
    const record: CalibrationRecord = {
      id: 'r',
      case: 'c',
      model: 'm',
      repeat: 0,
      prompt: 'q',
      transcript: { toolCalls: [], answer: 'a' },
      states: { 'judge-relevance': 's' },
      jevAssertScores: { 'judge-relevance': 0.9 },
      opusScore: { 'judge-relevance': 'yes' },
    };
    fs.writeFileSync(file, JSON.stringify([record]));
    const { io, seen } = sink();
    expect(runAnalyze(['--file', file], io)).toBe(0);
    expect(seen.out).toContain('judge-relevance');
    expect(seen.out).toContain('not enough yes and no answers');
    const bad = sink();
    expect(runAnalyze(['--file', '/nonexistent/r.json'], bad.io)).toBe(1);
    expect(bad.seen.err).toMatch(/Cannot read \/nonexistent\/r\.json: /);
    fs.writeFileSync(file, '{"not":"an array"}');
    const odd = sink();
    expect(runAnalyze(['--file', file], odd.io)).toBe(1);
    expect(odd.seen.err).toContain('the file holds no array of records');
  });
});
