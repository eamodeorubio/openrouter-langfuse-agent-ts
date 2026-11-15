import path from 'node:path';
import type { Io } from '../io.js';
import { finite, isObject } from '../json.js';
import JudgeProvider from '../judge/provider.js';
import { parseArgs } from './args.js';
import { forEachLimited } from './pool.js';
import {
  DEFAULT_CALIBRATION_FILE,
  lock,
  readOrReport,
  writeOrReport,
} from './records.js';
import { loadQuestions } from './rubrics.js';

const USAGE = 'Usage: calibrate jev [--file <file>] [--parallel <n>]\n';
const DEFAULT_PARALLEL = 4;
const SAVE_EVERY = 10;

/** The grader of a run, which the tests replace. Only the score of its answer is read, so its threshold does not matter. */
export type Judge = Pick<JudgeProvider, 'callApi'>;

/** Scores the rubrics of the controls that Jev has not scored, with the grader of a run. Returns the exit code. */
export const runJev = async (
  argv: string[],
  io: Io,
  judge: Judge = new JudgeProvider({ config: { threshold: 0.5 } }),
  /** The batch of calls after which the file is saved: the tests make it small. */
  saveEvery = SAVE_EVERY,
): Promise<number> => {
  const parsed = parseArgs(
    argv,
    { values: ['--file'], numbers: ['--parallel'] },
    USAGE,
  );
  if (typeof parsed === 'string') {
    io.err(parsed);
    return 2;
  }
  const file = path.resolve(
    parsed.values['--file'] ?? DEFAULT_CALIBRATION_FILE(),
  );
  const parallel = parsed.numbers['--parallel'] ?? DEFAULT_PARALLEL;
  if (!process.env.OPENROUTER_API_KEY) {
    io.err('OPENROUTER_API_KEY is not set, so nothing was scored.\n');
    return 1;
  }
  const release = lock(file, io);
  if (release === undefined) return 1;
  try {
    return await score(file, parallel, judge, saveEvery, io);
  } finally {
    release();
  }
};

/** The work of `runJev`, with the file locked. */
const score = async (
  file: string,
  parallel: number,
  judge: Judge,
  saveEvery: number,
  io: Io,
): Promise<number> => {
  const records = readOrReport(file, io);
  if (records === undefined) return 1;

  const questions = loadQuestions();
  const todo = records.flatMap((record) =>
    record.control === undefined
      ? []
      : Object.entries(record.states)
          .filter(([rubric]) => !(rubric in record.jevAssertScores))
          .map(([rubric, state]) => ({ record, rubric, state })),
  );
  let scored = 0;
  let failed = 0;
  let sinceSave = 0;
  let saved = true;
  const fail = (id: string, rubric: string, reason: string): void => {
    failed += 1;
    io.err(`${id} ${rubric}: ${reason}\n`);
  };
  try {
    await forEachLimited(todo, parallel, async ({ record, rubric, state }) => {
      const question = questions[rubric];
      if (question === undefined) {
        fail(record.id, rubric, 'there is no question for this rubric');
        return;
      }
      try {
        // The rubric and the state travel as promptfoo hands them to a grader.
        const answer = await judge.callApi(question, {
          prompt: { label: 'llm-rubric', raw: '' },
          vars: { rubric: question, output: state },
          bustCache: true,
        } as never);
        const output = answer.output;
        const score = isObject(output) ? output.score : undefined;
        if (finite(score)) {
          record.jevAssertScores[rubric] = score;
          scored += 1;
        } else {
          fail(
            record.id,
            rubric,
            ('error' in answer && answer.error) || 'no score in the answer',
          );
        }
      } catch (error) {
        fail(
          record.id,
          rubric,
          error instanceof Error ? error.message : String(error),
        );
      }
      sinceSave += 1;
      if (sinceSave >= saveEvery) {
        if (!writeOrReport(file, records, io)) saved = false;
        sinceSave = 0;
      }
    });
  } finally {
    // What was scored is paid for, whatever happened to the rest.
    if (!writeOrReport(file, records, io)) saved = false;
  }
  if (!saved) io.err('The scores were NOT saved: see the error above.\n');
  const controls = new Set(todo.map((item) => item.record.id)).size;
  io.out(
    `${scored} rubrics scored, ${failed} failed, in ${controls} controls.\n`,
  );
  return failed === 0 && saved ? 0 : 1;
};
