import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The environment variable that tells the checks where the instructions of the run are. */
export const INSTRUCTIONS_ENV = 'EVAL_INSTRUCTIONS';

export const INSTRUCTIONS_FILE = 'instructions.txt';

/** The instructions of the CLI under test cannot be found, or cannot be read. */
export class InstructionsError extends Error {}

/** The `INSTRUCTIONS` export of the `instructions.js` that sits beside the entry of a CLI. */
export const loadInstructions = async (cli: string): Promise<string> => {
  const file = path.join(path.dirname(cli), 'instructions.js');
  const fault = `The CLI has no readable instructions: ${file}`;
  let module: unknown;
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new InstructionsError(`${fault} could not be imported.`, {
      cause: error,
    });
  }
  const text = (module as { INSTRUCTIONS?: unknown }).INSTRUCTIONS;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new InstructionsError(
      `${fault} does not export INSTRUCTIONS as text.`,
    );
  }
  return text;
};

/** Writes the instructions beside the results and returns the path of the file. */
export const writeInstructions = (dir: string, text: string): string => {
  const file = path.join(dir, INSTRUCTIONS_FILE);
  fs.writeFileSync(file, text);
  return file;
};

/** The instructions of the run the checks belong to. Throws when the run has none. */
export const currentInstructions = (): string => {
  const file = process.env[INSTRUCTIONS_ENV];
  if (!file) {
    throw new InstructionsError(
      `The checks need the instructions of the run, and ${INSTRUCTIONS_ENV} does not name a file.`,
    );
  }
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new InstructionsError(
      `The instructions of the run cannot be read: ${file}.`,
    );
  }
};
