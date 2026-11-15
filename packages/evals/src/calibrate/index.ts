import type { Io } from '../io.js';
import { runAnalyze } from './analyze.js';
import { runCollect } from './collect.js';
import { runControls } from './controls.js';
import { runJev } from './jev.js';
import { runOpus } from './opus.js';

type Command = (argv: string[], io: Io) => number | Promise<number>;

const COMMANDS: Record<string, Command> = {
  collect: runCollect,
  controls: runControls,
  jev: runJev,
  opus: runOpus,
  analyze: runAnalyze,
};

/** The steps of a calibration, in the order they run. */
export const SUBCOMMANDS = Object.keys(COMMANDS);

const USAGE = `Usage: calibrate <${SUBCOMMANDS.join('|')}> [options]\n`;

/** Runs the subcommand named first with the rest of the arguments. Returns the exit code. */
export const dispatch = async (argv: string[], io: Io): Promise<number> => {
  const [name, ...rest] = argv;
  if (!Object.hasOwn(COMMANDS, String(name))) {
    io.err(USAGE);
    return 2;
  }
  return (COMMANDS[name as string] as Command)(rest, io);
};
