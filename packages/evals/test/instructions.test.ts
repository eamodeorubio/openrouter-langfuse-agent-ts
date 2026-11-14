import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentInstructions,
  INSTRUCTIONS_ENV,
  INSTRUCTIONS_FILE,
  InstructionsError,
  loadInstructions,
  writeInstructions,
} from '../src/oracle/instructions.js';

const dirWith = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-instr-'));
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

afterEach(() => vi.unstubAllEnvs());

describe('loadInstructions', () => {
  it('reads the INSTRUCTIONS export that sits beside the entry of the CLI', async () => {
    const dir = dirWith({
      'instructions.js': 'export const INSTRUCTIONS = "Be brief.";',
    });
    expect(await loadInstructions(path.join(dir, 'index.js'))).toBe(
      'Be brief.',
    );
  });

  it('fails with a message that names the file when there is none', async () => {
    const dir = dirWith({});
    const entry = path.join(dir, 'index.js');
    await expect(loadInstructions(entry)).rejects.toThrow(InstructionsError);
    await expect(loadInstructions(entry)).rejects.toThrow(
      `The CLI has no readable instructions: ${path.join(dir, 'instructions.js')} could not be imported.`,
    );
  });

  it('keeps the cause of an import that failed', async () => {
    const dir = dirWith({ 'instructions.js': 'export const = ;' });
    const error = await loadInstructions(path.join(dir, 'index.js')).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it.each([
    ['no export', 'export const OTHER = "x";'],
    ['an export that is not text', 'export const INSTRUCTIONS = 3;'],
    ['an empty export', 'export const INSTRUCTIONS = "  ";'],
  ])('fails with a message that names the file for %s', async (_, source) => {
    const dir = dirWith({ 'instructions.js': source });
    await expect(loadInstructions(path.join(dir, 'index.js'))).rejects.toThrow(
      `The CLI has no readable instructions: ${path.join(dir, 'instructions.js')} does not export INSTRUCTIONS as text.`,
    );
  });

  it('fails the same way for a file that does not parse', async () => {
    const dir = dirWith({ 'instructions.js': 'export const = ;' });
    await expect(loadInstructions(path.join(dir, 'index.js'))).rejects.toThrow(
      InstructionsError,
    );
  });
});

describe('the instructions of the run', () => {
  it('are written beside the results, and read back through EVAL_INSTRUCTIONS', () => {
    const dir = dirWith({});
    const file = writeInstructions(dir, 'Be brief.');
    expect(file).toBe(path.join(dir, INSTRUCTIONS_FILE));
    expect(INSTRUCTIONS_FILE).toBe('instructions.txt');
    expect(INSTRUCTIONS_ENV).toBe('EVAL_INSTRUCTIONS');
    vi.stubEnv(INSTRUCTIONS_ENV, file);
    expect(currentInstructions()).toBe('Be brief.');
  });

  it('are an error when a check needs them and the run has none', () => {
    vi.stubEnv(INSTRUCTIONS_ENV, '');
    expect(() => currentInstructions()).toThrow(InstructionsError);
    expect(() => currentInstructions()).toThrow(
      'The checks need the instructions of the run, and EVAL_INSTRUCTIONS does not name a file.',
    );
  });

  it('are an error when the file is gone', () => {
    vi.stubEnv(INSTRUCTIONS_ENV, '/nonexistent/instructions.txt');
    expect(() => currentInstructions()).toThrow(
      'The instructions of the run cannot be read: /nonexistent/instructions.txt.',
    );
  });
});
