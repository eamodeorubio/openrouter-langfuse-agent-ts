import fs from 'node:fs';
import path from 'node:path';
import type { Io } from '../io.js';
import { type Run, readRuns } from '../report/results.js';
import { readGateConfig } from './config.js';
import { type Decision, decide } from './decide.js';

const USAGE = 'Usage: gate <results.json> [--config <gate.yaml>]\n';

/** `packages/evals/gate.yaml`, whatever the working directory. */
const DEFAULT_CONFIG = path.resolve(import.meta.dirname, '../../gate.yaml');

const EXIT = { pass: 0, fail: 1, unreadable: 2, inconclusive: 4 } as const;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const four = (value: number): string => value.toFixed(4);

type Judged = Extract<Decision, { ok: true }>;

const rowsOf = (decision: Judged, k: number): string[] => {
  const lines = [
    ...decision.rows.map((row) => ({
      name: row.caseName,
      counts: [`c=${row.c}/${row.n}`, `err=${row.errors}`],
      passHat: row.passHat,
      floor: row.floor,
      below: row.below,
    })),
    {
      name: 'mean',
      counts: [],
      passHat: decision.mean.value,
      floor: decision.mean.floor,
      below: decision.mean.below,
    },
  ];
  const width = Math.max(...lines.map((line) => line.name.length));
  return lines.map((line) =>
    [
      line.name.padEnd(width),
      ...line.counts,
      `pass^${k}=${four(line.passHat)}`,
      `floor ${four(line.floor)}`,
      line.below ? 'below' : 'ok',
    ].join('  '),
  );
};

const verdictLine = (decision: Judged): string => {
  if (decision.verdict === 'pass') return 'verdict: pass';
  if (decision.verdict === 'inconclusive') {
    return `verdict: inconclusive (${plural(decision.errors, 'provider error', 'provider errors')}; the breaches clear when they count as passed, run the gate again)`;
  }
  const parts = [
    ...(decision.casesBelow > 0
      ? [
          decision.casesBelow === 1
            ? '1 case below its floor'
            : `${decision.casesBelow} cases below their floor`,
        ]
      : []),
    ...(decision.mean.below ? ['mean below its floor'] : []),
  ];
  return `verdict: fail (${parts.join(', ')})`;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const readText = (file: string): string => fs.readFileSync(file, 'utf8');

/** Judges a promptfoo results file against a gate file. Returns the exit code. */
export const gate = (argv: string[], io: Io): number => {
  let results: string | undefined;
  let configFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--config' && configFile === undefined) {
      configFile = argv[++i];
      if (configFile === undefined) {
        io.err(`--config takes a file.\n${USAGE}`);
        return EXIT.unreadable;
      }
    } else if (arg.startsWith('-') || results !== undefined) {
      io.err(`Unexpected argument: ${arg}\n${USAGE}`);
      return EXIT.unreadable;
    } else {
      results = arg;
    }
  }
  if (results === undefined) {
    io.err(`The results file is missing.\n${USAGE}`);
    return EXIT.unreadable;
  }
  const gateFile = configFile ?? DEFAULT_CONFIG;

  let text: string;
  try {
    text = readText(gateFile);
  } catch (error) {
    io.err(`Cannot read the gate file ${gateFile}: ${reasonOf(error)}\n`);
    return EXIT.unreadable;
  }
  const config = readGateConfig(text);
  if (!config.ok) {
    io.err(`Invalid gate file ${gateFile}: ${config.message}\n`);
    return EXIT.unreadable;
  }

  let runs: Run[];
  try {
    runs = readRuns(JSON.parse(readText(results))).runs;
  } catch (error) {
    io.err(`Cannot read the results file ${results}: ${reasonOf(error)}\n`);
    return EXIT.unreadable;
  }

  const decision = decide(runs, config.config);
  if (!decision.ok) {
    io.err(`Cannot judge ${results}: ${decision.message}\n`);
    return EXIT.unreadable;
  }
  io.out(
    `${[...rowsOf(decision, config.config.k), verdictLine(decision)].join('\n')}\n`,
  );
  return EXIT[decision.verdict];
};
