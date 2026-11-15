import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/calibrate/args.js';

const USAGE = 'Usage: x\n';
const spec = {
  values: ['--file'],
  numbers: ['--parallel'],
  flags: ['--force'],
};

describe('parseArgs', () => {
  it('reads a value, a number, a flag and a positional argument, in any order', () => {
    const parsed = parseArgs(
      ['--force', 'results.json', '--parallel', '3', '--file', 'f.json'],
      { ...spec, positional: 'results file' },
      USAGE,
    );
    expect(parsed).toEqual({
      values: { '--file': 'f.json' },
      numbers: { '--parallel': 3 },
      flags: new Set(['--force']),
      positional: 'results.json',
    });
  });

  it('reads nothing for no arguments, when nothing is required', () => {
    expect(parseArgs([], spec, USAGE)).toEqual({
      values: {},
      numbers: {},
      flags: new Set(),
      positional: undefined,
    });
  });

  it('refuses an option it does not know, with the usage', () => {
    expect(parseArgs(['--bogus'], spec, USAGE)).toBe(
      'Unexpected argument: --bogus\nUsage: x\n',
    );
    expect(parseArgs(['--force', 'stray'], spec, USAGE)).toBe(
      'Unexpected argument: stray\nUsage: x\n',
    );
  });

  it('refuses an option that takes a value when none follows, as an argument it does not expect', () => {
    expect(parseArgs(['--file'], spec, USAGE)).toBe(
      'Unexpected argument: --file\nUsage: x\n',
    );
    expect(parseArgs(['--parallel'], spec, USAGE)).toBe(
      'Unexpected argument: --parallel\nUsage: x\n',
    );
  });

  it('refuses a number that is not whole or not from 1, naming the option', () => {
    for (const value of ['0', '-1', 'x', '1.5', '', 'Infinity']) {
      expect(parseArgs(['--parallel', value], spec, USAGE)).toBe(
        '--parallel takes a whole number from 1.\nUsage: x\n',
      );
    }
    expect(parseArgs(['--parallel', '1'], spec, USAGE)).toMatchObject({
      numbers: { '--parallel': 1 },
    });
  });

  it('takes a value that looks like an option as the value of the option before it', () => {
    expect(parseArgs(['--file', '--force'], spec, USAGE)).toMatchObject({
      values: { '--file': '--force' },
      flags: new Set(),
    });
  });

  it('asks for the positional argument by name when the command takes one, and refuses a second', () => {
    const withPositional = { ...spec, positional: 'results file' };
    expect(parseArgs([], withPositional, USAGE)).toBe(
      'The results file is missing.\nUsage: x\n',
    );
    expect(parseArgs(['a', 'b'], withPositional, USAGE)).toBe(
      'Unexpected argument: b\nUsage: x\n',
    );
    expect(parseArgs(['-x'], withPositional, USAGE)).toBe(
      'Unexpected argument: -x\nUsage: x\n',
    );
  });

  it('takes no positional argument when the command names none', () => {
    expect(parseArgs(['a'], spec, USAGE)).toBe(
      'Unexpected argument: a\nUsage: x\n',
    );
  });

  it('never throws, and gives a message or a parse, for any arguments', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 6 }), (argv) => {
        const result = parseArgs(argv, { ...spec, positional: 'file' }, USAGE);
        expect(['string', 'object']).toContain(typeof result);
      }),
    );
  });
});

describe('parseArgs with a spec that names no option', () => {
  it('refuses any option as unexpected, and does not throw', () => {
    expect(parseArgs(['--file', 'x'], {}, USAGE)).toBe(
      'Unexpected argument: --file\nUsage: x\n',
    );
    expect(parseArgs([], {}, USAGE)).toEqual({
      values: {},
      numbers: {},
      flags: new Set(),
      positional: undefined,
    });
  });
});
