import path from 'node:path';
import type { Io } from '../io.js';
import { STATE_BUILDERS } from '../judge/state.js';
import { parseArgs } from './args.js';
import {
  DEFAULT_CALIBRATION_FILE,
  lock,
  readOrReport,
  writeOrReport,
} from './records.js';
import type { CalibrationRecord, ControlKind } from './types.js';

const USAGE = 'Usage: calibrate controls [--file <file>]\n';

/** A number as an answer writes it: an optional `$`, digits, thousands separators and decimals. */
const FIGURE = /(?<![\w./-])(\$)?(\d[\d,]*)(\.\d+)?(?![\w-])/g;

/** What follows a figure that is a price or a size: a currency, a unit of tokens, or a rate. */
const UNIT =
  /^\s*(?:USD\b|dollars?\b|tokens?\b|\/\s*M\b|per\s+(?:1\s*)?M(?:illion)?\b)/i;

/**
 * The first figure of an answer that is a price or a size: written with a
 * `$`, with thousands separators, or before a currency or a unit of tokens.
 * A list number, a year or a count of models is not one.
 */
const findFigure = (answer: string): RegExpExecArray | undefined =>
  [...answer.matchAll(FIGURE)].find(
    (match) =>
      match[1] !== undefined ||
      (match[2] as string).includes(',') ||
      UNIT.test(answer.slice(match.index + match[0].length)),
  );

/** The answer with its first price or size replaced by one seven times as large, written the same way. Undefined without one. */
const inventFigure = (answer: string): string | undefined => {
  const match = findFigure(answer);
  if (!match) return undefined;
  const whole = match[0];
  const dollar = match[1] ?? '';
  const integer = match[2] as string;
  const fraction = match[3] ?? '';
  const value = Number(`${integer.replace(/,/g, '')}${fraction}`) * 7 || 7;
  const decimals = Math.max(0, fraction.length - 1);
  const grouped = integer.includes(',');
  const written = grouped
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : value.toFixed(decimals);
  // The match is replaced where it stands, and not the first place its text appears.
  return (
    answer.slice(0, match.index) +
    dollar +
    written +
    answer.slice(match.index + whole.length)
  );
};

/** What makes two tool calls the same call: the tool and its arguments, compared as the text the model wrote. */
const callKey = (call: { name: string; arguments: string }): string =>
  JSON.stringify([call.name, call.arguments]);

/** Orders records by id. No two records have the same id. */
const byId = (a: CalibrationRecord, b: CalibrationRecord): number =>
  // Stryker disable next-line EqualityOperator: equivalent because no two records have the same id
  a.id < b.id ? -1 : 1;

/**
 * The record of the next case, in the order of the case names and round the
 * end, that a control borrows from: the first of its runs, by id. The same
 * record always borrows from the same one, whatever the order they come in.
 */
const borrowFrom = (
  record: CalibrationRecord,
  pool: CalibrationRecord[],
): CalibrationRecord | undefined => {
  const others = [
    ...new Set(
      pool.filter((other) => other.case !== record.case).map((o) => o.case),
    ),
  ].sort();
  // Stryker disable next-line EqualityOperator: equivalent because `others` holds no case named like the record's
  const next = others.find((name) => name > record.case) ?? others[0];
  // The pool is in the order of the ids, so the first run of the case is the first by id.
  return pool.find((other) => other.case === next);
};

/** A control: the record with another answer or other tool calls, its states rebuilt, and the rubrics it should fail. */
const control = (
  record: CalibrationRecord,
  kind: ControlKind,
  transcript: CalibrationRecord['transcript'],
  fails: string[],
): CalibrationRecord | undefined => {
  const expectedFail = fails.filter((rubric) => rubric in record.states);
  if (expectedFail.length === 0) return undefined;
  if (JSON.stringify(transcript) === JSON.stringify(record.transcript)) {
    return undefined;
  }
  const output = { success: true, question: record.prompt, ...transcript };
  // The answers of Opus and Jev are about the run, and not about this text.
  const { opusScore: _score, opusReason: _reason, ...rest } = record;
  return {
    ...rest,
    id: `${record.id}::${kind}`,
    transcript,
    states: Object.fromEntries(
      // Only the rubrics the control is built to fail are asked: the others add calls and say nothing about it.
      expectedFail.flatMap((rubric) => {
        const build = STATE_BUILDERS[rubric];
        // Stryker disable next-line ArrayDeclaration: equivalent because every rubric a control is built to fail has a builder
        return build ? [[rubric, build(output, {})] as const] : [];
      }),
    ),
    jevAssertScores: {},
    control: kind,
    expectedFail,
  };
};

/**
 * Copies of the runs that are bad by construction: an answer from another
 * case, an invented figure, tool calls from another case. A control of a
 * control is not made, and a control that cannot be made is left out.
 */
export const makeControls = (
  records: CalibrationRecord[],
): CalibrationRecord[] => {
  const runs = records
    .filter((record) => record.control === undefined)
    .sort(byId);
  return runs.flatMap((record) => {
    const { toolCalls, answer } = record.transcript;
    const swappedAnswer = borrowFrom(record, runs);
    const own = new Set(toolCalls.map(callKey));
    // Tool calls that repeat a call of the record would still ground its answer: the control would not be bad.
    const swappedTools = borrowFrom(
      record,
      runs.filter(
        ({ transcript }) =>
          transcript.toolCalls.length > 0 &&
          !transcript.toolCalls.some((call) => own.has(callKey(call))),
      ),
    );
    const invented = inventFigure(answer);
    return [
      swappedAnswer &&
        control(
          record,
          'answer-swapped',
          { toolCalls, answer: swappedAnswer.transcript.answer },
          ['judge-grounding', 'judge-relevance', 'judge-usefulness'],
        ),
      invented !== undefined &&
        control(record, 'figure-invented', { toolCalls, answer: invented }, [
          'judge-grounding',
        ]),
      swappedTools &&
        control(
          record,
          'tools-swapped',
          { toolCalls: swappedTools.transcript.toolCalls, answer },
          ['judge-grounding', 'judge-tool-usage'],
        ),
    ].filter((made): made is CalibrationRecord => Boolean(made));
  });
};

/** Adds the controls of the records of a file to it, once. Returns the exit code. */
export const runControls = (argv: string[], io: Io): number => {
  const parsed = parseArgs(argv, { values: ['--file'] }, USAGE);
  if (typeof parsed === 'string') {
    io.err(parsed);
    return 2;
  }
  const file = path.resolve(
    parsed.values['--file'] ?? DEFAULT_CALIBRATION_FILE(),
  );
  const release = lock(file, io);
  if (release === undefined) return 1;
  try {
    const records = readOrReport(file, io);
    if (records === undefined) return 1;
    const known = new Set(records.map((record) => record.id));
    const added = makeControls(records).filter((made) => !known.has(made.id));
    if (!writeOrReport(file, [...records, ...added], io)) return 1;
    io.out(`${added.length} controls added to ${file}.\n`);
    return 0;
  } finally {
    release();
  }
};
