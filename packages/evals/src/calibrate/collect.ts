import fs from 'node:fs';
import path from 'node:path';
import { asSuccess } from '../checks/run.js';
import type { Io } from '../io.js';
import { isObject } from '../json.js';
import { STATE_BUILDERS } from '../judge/state.js';
import { type Run, readRuns } from '../report/results.js';
import { parseArgs } from './args.js';
import {
  backUp,
  DEFAULT_CALIBRATION_FILE,
  lock,
  writeOrReport,
} from './records.js';
import type { CalibrationRecord } from './types.js';

const USAGE =
  'Usage: calibrate collect <results.json> [--out <file>] [--force]\n';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * One record for each run that a rubric graded: what it was asked, what it
 * did, the state each rubric was sent, and the scores Jev gave. A run that
 * ended in a provider error was not graded, and a run no rubric asked about
 * has nothing to calibrate.
 */
export const collectRecords = (file: unknown): CalibrationRecord[] => {
  const { runs } = readRuns(file);
  const entries = (file as { results: { results: unknown[] } }).results.results;
  const records = entries.flatMap((entry, index) => {
    // readRuns gives one run for each entry, in the same order.
    const run = runs[index] as Run;
    if (run.error || run.rubrics.length === 0) return [];
    const output = (entry as { response?: { output?: unknown } }).response
      ?.output;
    const success = asSuccess(output);
    if (!success) return [];
    const vars = (entry as { vars?: unknown }).vars;
    const question = isObject(vars) ? vars.question : undefined;
    const context = { vars: { question } };
    const repeat = (entry as { repeatIndex?: unknown }).repeatIndex;
    const states = Object.fromEntries(
      run.rubrics.flatMap((rubric) => {
        const build = STATE_BUILDERS[rubric];
        return build ? [[rubric, build(output, context)] as const] : [];
      }),
    );
    return [
      {
        id: `${run.caseName}::${run.model}::${typeof repeat === 'number' ? repeat : index}`,
        case: run.caseName,
        model: run.model,
        repeat: typeof repeat === 'number' ? repeat : index,
        prompt: text(success.question) ?? text(question) ?? '',
        transcript: { toolCalls: success.toolCalls, answer: success.answer },
        states,
        jevAssertScores: run.judges,
      },
    ];
  });
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`two runs have the id ${record.id}`);
    }
    seen.add(record.id);
  }
  return records;
};

/** Collects the records of a results file and writes them as a JSON array. Returns the exit code. */
export const runCollect = (argv: string[], io: Io): number => {
  const parsed = parseArgs(
    argv,
    { values: ['--out'], flags: ['--force'], positional: 'results file' },
    USAGE,
  );
  if (typeof parsed === 'string') {
    io.err(parsed);
    return 2;
  }
  const source = parsed.positional as string;
  const out = path.resolve(
    parsed.values['--out'] ?? DEFAULT_CALIBRATION_FILE(),
  );
  const force = parsed.flags.has('--force');
  const exists = fs.existsSync(out);
  if (exists && !force) {
    io.err(
      `${out} exists and may hold paid answers. Give another --out, or --force to replace it.\n`,
    );
    return 1;
  }
  let records: CalibrationRecord[];
  try {
    // Stryker disable next-line StringLiteral: equivalent because JSON.parse reads a Buffer as its UTF-8 text
    records = collectRecords(JSON.parse(fs.readFileSync(source, 'utf8')));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Cannot collect from ${source}: ${reason}\n`);
    return 1;
  }
  const release = lock(out, io);
  if (release === undefined) return 1;
  try {
    // The file that is replaced may hold paid answers: it is kept beside the new one, and no earlier copy is overwritten.
    if (exists) backUp(out);
    if (!writeOrReport(out, records, io)) return 1;
    io.out(`${records.length} records written to ${out}.\n`);
    return 0;
  } finally {
    release();
  }
};
