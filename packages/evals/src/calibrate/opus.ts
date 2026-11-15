import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Io } from '../io.js';
import { finite, isObject, parseJson } from '../json.js';
import { parseArgs } from './args.js';
import { forEachLimited } from './pool.js';
import {
  DEFAULT_CALIBRATION_FILE,
  lock,
  readOrReport,
  writeOrReport,
} from './records.js';
import { loadQuestions } from './rubrics.js';
import type { Verdict } from './types.js';

const USAGE =
  'Usage: calibrate opus [--file <file>] [--parallel <n>] [--max-calls <n>]\n';
const DEFAULT_PARALLEL = 3;
const SAVE_EVERY = 10;
/** A call that takes longer than this is killed and reported, so that one hung `claude` cannot stall the run. */
const CALL_TIMEOUT_MS = 600_000;
const MODEL = 'claude-opus-5-5';
const VERDICTS = ['yes', 'no', 'ambiguous'];

const SYSTEM =
  'You are the reference judge of a calibration. You answer one yes/no question about a text, and nothing else.';

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
});

/** The prompt for one rubric of one record: its exact question and the exact state Jev was sent. */
const promptFor = (question: string, state: string): string =>
  `Question: ${question}\n\nText:\n<<<\n${state}\n>>>\n\nAnswer with the verdict yes, no or ambiguous (ambiguous when the text does not allow a decision), and one sentence of reason.`;

interface Judged {
  verdict: Verdict;
  reason: string;
  cost?: number;
}

/** The environment of `claude`: the one of the run, without the keys of OpenRouter and Langfuse, which it does not need. */
const claudeEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(OPENROUTER_|LANGFUSE_|OTEL_)/.test(name),
    ),
  );

/** Runs `claude -p` once, with the prompt on its input, and reads its JSON answer. Rejects with the reason when it cannot. */
const ask = (prompt: string, cwd: string, timeoutMs: number): Promise<Judged> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.env.EVAL_CLAUDE ?? 'claude',
      [
        '-p',
        '--model',
        MODEL,
        '--effort',
        'high',
        '--tools',
        '',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--system-prompt',
        SYSTEM,
        '--output-format',
        'json',
        '--json-schema',
        SCHEMA,
      ],
      {
        cwd,
        env: claudeEnvironment(),
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) =>
      reject(new Error(`claude did not start: ${error.message}`)),
    );
    // A state can be larger than an argument may be, so the prompt goes on the input.
    // Stryker disable next-line StringLiteral,CallExpression: equivalent in a test, which cannot make the operating system report a broken pipe on cue
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    child.on('close', (code, signal) => {
      if (signal !== null) {
        // The call is killed with SIGKILL when it runs out of time, and by no other signal of ours.
        reject(
          new Error(
            signal === 'SIGKILL'
              ? `claude timed out after ${timeoutMs / 1000} s`
              : `claude was stopped by ${signal}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        // `claude` can say why on its output, as JSON, and nothing on its error output.
        const printed = parseJson(stdout);
        const result = isObject(printed) ? printed.result : undefined;
        const said =
          stderr.trim() ||
          (typeof result === 'string' ? result.trim().slice(0, 300) : '');
        reject(
          new Error(
            `claude exited with code ${code}${said === '' ? '' : `: ${said}`}`,
          ),
        );
        return;
      }
      const answer = parseJson(stdout);
      if (!isObject(answer)) {
        reject(new Error('claude printed no JSON'));
        return;
      }
      if (answer.is_error === true) {
        reject(
          new Error(`claude answered with an error: ${String(answer.subtype)}`),
        );
        return;
      }
      const given = answer.structured_output;
      const verdict = isObject(given) ? given.verdict : undefined;
      if (!VERDICTS.includes(verdict as string)) {
        reject(new Error('claude gave no verdict'));
        return;
      }
      const reason = isObject(given) ? given.reason : undefined;
      resolve({
        verdict: verdict as Verdict,
        reason: typeof reason === 'string' ? reason : '',
        ...(finite(answer.total_cost_usd)
          ? { cost: answer.total_cost_usd }
          : {}),
      });
    });
  });

/** Asks Opus each rubric of each record that has no answer yet. Returns the exit code. */
export const runOpus = async (
  argv: string[],
  io: Io,
  /** The batch of calls after which the file is saved, and the time a call may take: the tests make them small. */
  options: { saveEvery?: number; timeoutMs?: number } = {},
): Promise<number> => {
  const saveEvery = options.saveEvery ?? SAVE_EVERY;
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const parsed = parseArgs(
    argv,
    { values: ['--file'], numbers: ['--parallel', '--max-calls'] },
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
  const maxCalls = parsed.numbers['--max-calls'] ?? Number.POSITIVE_INFINITY;
  const release = lock(file, io);
  if (release === undefined) return 1;
  try {
    return await judge(file, parallel, maxCalls, saveEvery, timeoutMs, io);
  } finally {
    release();
  }
};

/** The work of `runOpus`, with the file locked. */
const judge = async (
  file: string,
  parallel: number,
  maxCalls: number,
  saveEvery: number,
  timeoutMs: number,
  io: Io,
): Promise<number> => {
  const records = readOrReport(file, io);
  if (records === undefined) return 1;

  const questions = loadQuestions();
  let failed = 0;
  const asked = records.flatMap((record) =>
    Object.entries(record.states)
      .filter(([rubric]) => record.opusScore?.[rubric] === undefined)
      .map(([rubric, state]) => ({ record, rubric, state })),
  );
  // A rubric with no question costs no call, so it takes none of the budget.
  const todo = asked
    .filter(({ record, rubric }) => {
      if (questions[rubric] !== undefined) return true;
      failed += 1;
      io.err(`${record.id} ${rubric}: there is no question for this rubric\n`);
      return false;
    })
    .slice(0, maxCalls);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-opus-cwd-'));
  let judged = 0;
  let cost = 0;
  let sinceSave = 0;
  let saved = true;
  try {
    await forEachLimited(todo, parallel, async ({ record, rubric, state }) => {
      try {
        const answer = await ask(
          promptFor(questions[rubric] as string, state),
          cwd,
          timeoutMs,
        );
        record.opusScore = { ...record.opusScore, [rubric]: answer.verdict };
        record.opusReason = { ...record.opusReason, [rubric]: answer.reason };
        cost += answer.cost ?? 0;
        judged += 1;
      } catch (error) {
        failed += 1;
        io.err(
          `${record.id} ${rubric}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      sinceSave += 1;
      if (sinceSave >= saveEvery) {
        if (!writeOrReport(file, records, io)) saved = false;
        sinceSave = 0;
      }
    });
  } finally {
    // What was judged is paid for, whatever happened to the rest.
    if (!writeOrReport(file, records, io)) saved = false;
    // Stryker disable next-line BooleanLiteral: equivalent for `force`, because the directory made above is there to be removed, and a directory with nothing in it needs no `recursive`
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  if (!saved) io.err('The answers were NOT saved: see the error above.\n');
  const touched = new Set(todo.map((item) => item.record.id)).size;
  io.out(
    `${judged} rubrics judged, ${failed} failed, in ${touched} records.${cost > 0 ? ` The calls cost about $${cost.toFixed(2)}.` : ''}\n`,
  );
  return failed === 0 && saved ? 0 : 1;
};
