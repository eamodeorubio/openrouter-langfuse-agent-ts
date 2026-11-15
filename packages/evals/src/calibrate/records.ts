import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Io } from '../io.js';
import { finite, isObject } from '../json.js';
import type { CalibrationRecord } from './types.js';

const FILE_NAME = 'jev-calibration-transcripts.json';

/** Where the records go unless `--out` or `--file` says another: a file in the home directory, outside the repository. */
export const DEFAULT_CALIBRATION_FILE = (): string =>
  path.join(process.env.HOME ?? os.homedir(), FILE_NAME);

const VERDICTS = ['yes', 'no', 'ambiguous'];
const CONTROLS = ['answer-swapped', 'figure-invented', 'tools-swapped'];

/** The first thing wrong with a record, or undefined. The file is long-lived and may be edited by hand. */
const problemWith = (record: unknown): string | undefined => {
  if (!isObject(record)) return 'is not an object';
  if (typeof record.id !== 'string' || record.id === '') return 'has no id';
  for (const name of ['states', 'jevAssertScores', 'transcript']) {
    if (!isObject(record[name])) return `has no ${name}`;
  }
  const { states, jevAssertScores, transcript } = record as {
    states: Record<string, unknown>;
    jevAssertScores: Record<string, unknown>;
    transcript: Record<string, unknown>;
  };
  if (typeof transcript.answer !== 'string') return 'has no transcript.answer';
  if (!Array.isArray(transcript.toolCalls))
    return 'has no transcript.toolCalls';
  if (!Object.values(states).every((state) => typeof state === 'string')) {
    return 'has a state that is not text';
  }
  if (!Object.values(jevAssertScores).every((score) => finite(score))) {
    return 'has a score that is not a number';
  }
  if (record.opusScore !== undefined) {
    const { opusScore } = record;
    if (
      !isObject(opusScore) ||
      !Object.values(opusScore).every((verdict) =>
        VERDICTS.includes(verdict as string),
      )
    ) {
      return 'has an opusScore that is not yes, no or ambiguous';
    }
  }
  if (
    record.control !== undefined &&
    !CONTROLS.includes(record.control as string)
  ) {
    return 'has a control that is not known';
  }
  return undefined;
};

/** The records of a file. Throws with the reason when it cannot be read, holds no array, or holds a record that cannot be used. */
export const readRecords = (file: string): CalibrationRecord[] => {
  // Stryker disable next-line StringLiteral: equivalent because JSON.parse reads a Buffer as its UTF-8 text
  const records: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(records)) {
    throw new Error('the file holds no array of records');
  }
  records.forEach((record, index) => {
    const problem = problemWith(record);
    if (problem !== undefined) {
      throw new Error(`record ${index + 1} ${problem}`);
    }
  });
  return records as CalibrationRecord[];
};

/**
 * Writes the records so that a crash cannot leave half a file: to a file beside
 * it, then renamed over it. The file holds paid answers, so only its owner
 * may read it.
 */
export const writeRecords = (
  file: string,
  records: CalibrationRecord[],
): void => {
  const next = `${file}.tmp`;
  // A file left by a crash keeps its own mode, so it goes first.
  fs.rmSync(next, { force: true });
  fs.writeFileSync(next, `${JSON.stringify(records, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(next, file);
};

/** Reads the file for a command, or says why it cannot and returns undefined. */
export const readOrReport = (
  file: string,
  io: Io,
): CalibrationRecord[] | undefined => {
  try {
    return readRecords(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Cannot read ${file}: ${reason}\n`);
    return undefined;
  }
};

/** Writes the file for a command, or says why it cannot and returns false. */
export const writeOrReport = (
  file: string,
  records: CalibrationRecord[],
  io: Io,
): boolean => {
  try {
    writeRecords(file, records);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Cannot write ${file}: ${reason}\n`);
    return false;
  }
};

/** Where the copy of a file goes: beside it, under a name that no earlier copy has. */
const backupName = (file: string): string => {
  const first = `${file}.bak`;
  if (!fs.existsSync(first)) return first;
  let n = 2;
  while (fs.existsSync(`${first}.${n}`)) n += 1;
  return `${first}.${n}`;
};

/** Copies a file that may hold paid answers beside itself, never over an earlier copy, readable by its owner only. Returns the path. */
export const backUp = (file: string): string => {
  const copy = backupName(file);
  fs.copyFileSync(file, copy);
  fs.chmodSync(copy, 0o600);
  return copy;
};

/**
 * Takes the lock of a file, for a command that writes it, so that two of them
 * cannot read it, work, and write it back over each other's paid answers.
 * Returns the way to let go of it, or undefined, after saying why, when
 * another command holds it.
 */
export const lock = (file: string, io: Io): (() => void) | undefined => {
  const lockFile = `${file}.lock`;
  try {
    fs.writeFileSync(lockFile, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    // Any other failure (no such folder, no right to write) is reported by the read or write that follows, in its own words.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return () => {};
    io.err(
      `${file} is in use by another calibration command: ${lockFile} exists. If none is running, remove it.\n`,
    );
    return undefined;
  }
  return () => fs.rmSync(lockFile, { force: true });
};
