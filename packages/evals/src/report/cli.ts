import fs from 'node:fs';
import path from 'node:path';
import type { Io } from '../io.js';
import { TARGET_FILE } from '../target.js';
import { formatReport, wallTimeLine } from './format.js';
import { DEFAULT_KS, parseKs } from './ks.js';
import { readRuns } from './results.js';
import { summarize } from './summary.js';

/** The line that names what the run evaluated, from the file beside the results. Empty when the run left none. */
const targetLine = (results: string): string => {
  try {
    return `target: ${fs.readFileSync(path.join(path.dirname(results), TARGET_FILE), 'utf8').trim()}\n`;
  } catch {
    return '';
  }
};

const USAGE = 'Usage: report <results.json> [--k 1,3,5]\n';

/** Prints the pass@k and pass^k report of a promptfoo results file. Returns the exit code. */
export const report = (argv: string[], io: Io): number => {
  let file: string | undefined;
  let ks = DEFAULT_KS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--k') {
      const parsed = parseKs(argv[++i]);
      if (!parsed) {
        io.err(`--k takes whole numbers from 1, such as 1,3,5.\n${USAGE}`);
        return 2;
      }
      ks = parsed;
    } else if (arg.startsWith('-') || file !== undefined) {
      io.err(`Unexpected argument: ${arg}\n${USAGE}`);
      return 2;
    } else {
      file = arg;
    }
  }
  if (file === undefined) {
    io.err(`The results file is missing.\n${USAGE}`);
    return 2;
  }

  try {
    // Stryker disable next-line StringLiteral: equivalent because JSON.parse reads a Buffer as its UTF-8 text
    const raw = fs.readFileSync(file, 'utf8');
    const read = readRuns(JSON.parse(raw));
    io.out(
      targetLine(file) +
        formatReport(summarize(read.runs, ks, read.thresholds), ks) +
        wallTimeLine(read, read.runs.length),
    );
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Cannot report on ${file}: ${reason}\n`);
    return 1;
  }
};
