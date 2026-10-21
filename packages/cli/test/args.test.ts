import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/args.js';
import { UsageError } from '../src/errors.js';

describe('parseCliArgs', () => {
  it('returns nothing when no argument is given', () => {
    expect(parseCliArgs([])).toEqual({
      question: undefined,
      model: undefined,
      thinking: undefined,
      verbose: false,
    });
  });

  it('reads the question from -q', () => {
    expect(parseCliArgs(['-q', 'What is a token?']).question).toBe(
      'What is a token?',
    );
  });

  it('reads the model from --model', () => {
    expect(parseCliArgs(['--model', 'a/b']).model).toBe('a/b');
  });

  it('reads both together, in any order', () => {
    expect(parseCliArgs(['--model', 'a/b', '-q', 'hi'])).toEqual({
      question: 'hi',
      model: 'a/b',
      thinking: undefined,
      verbose: false,
    });
  });

  it.each([
    ['--thinking', ['--thinking'], true],
    ['--no-thinking', ['--no-thinking'], false],
    ['neither flag', [], undefined],
  ])('reads %s as thinking = %s', (_name, argv, thinking) => {
    expect(parseCliArgs(argv).thinking).toBe(thinking);
  });

  it.each([
    ['--verbose', ['--verbose'], true],
    ['no flag', [], false],
  ])('reads %s as verbose = %s', (_name, argv, verbose) => {
    expect(parseCliArgs(argv).verbose).toBe(verbose);
  });

  it('lets --verbose go with the other flags', () => {
    expect(
      parseCliArgs(['--verbose', '-q', 'hi', '--no-thinking']),
    ).toMatchObject({ question: 'hi', thinking: false, verbose: true });
  });

  it.each([
    ['--thinking first', ['--thinking', '--no-thinking']],
    ['--no-thinking first', ['--no-thinking', '--thinking']],
  ])('rejects both thinking flags together (%s) and says so', (_name, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(/--thinking.*--no-thinking/);
  });

  it('accepts an empty -q value and leaves the judgement to the caller', () => {
    expect(parseCliArgs(['-q', '']).question).toBe('');
  });

  it.each([
    ['a question that starts with a dash', ['-q', '-5 degrees'], '-5 degrees'],
    ['a lone dash', ['-q', '-'], '-'],
    ['a double dash', ['-q', '--'], '--'],
    ['an option-looking word', ['-q', '--model'], '--model'],
  ])('takes %s as the value of -q', (_name, argv, question) => {
    expect(parseCliArgs(argv).question).toBe(question);
  });

  it('reads a dash-leading question after --model', () => {
    expect(parseCliArgs(['--model', 'a/b', '-q', '-5 degrees'])).toEqual({
      question: '-5 degrees',
      model: 'a/b',
      thinking: undefined,
      verbose: false,
    });
  });

  it('reports a trailing -q as a missing value', () => {
    expect(() => parseCliArgs(['-q'])).toThrow(/argument missing/);
  });

  it('does not let a consumed value hide the option after it', () => {
    expect(() => parseCliArgs(['-q', '-q', '-z'])).toThrow(UsageError);
  });

  it('still rejects the word that follows a dash-leading question', () => {
    expect(() => parseCliArgs(['-q', '--model', 'x'])).toThrow(UsageError);
  });

  it.each([
    ['a stray positional', ['-q', 'hi', 'extra']],
    ['a lone positional', ['hello']],
    ['an unknown option', ['--frobnicate']],
    ['-q without a value', ['-q']],
    ['--model without a value', ['--model']],
  ])('throws a UsageError on %s', (_name, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
  });

  it('returns exactly the values it was given, for any well-formed list', () => {
    const model = fc.string().filter((text) => !text.startsWith('-'));
    fc.assert(
      fc.property(
        fc.option(
          fc.oneof(
            fc.string(),
            fc.string().map((text) => `-${text}`),
          ),
          { nil: undefined },
        ),
        fc.option(model, { nil: undefined }),
        fc.boolean(),
        fc.constantFrom(undefined, true, false),
        fc.boolean(),
        (question, model, modelFirst, thinking, verbose) => {
          const q = question === undefined ? [] : ['-q', question];
          const m = model === undefined ? [] : ['--model', model];
          const t =
            thinking === undefined
              ? []
              : [thinking ? '--thinking' : '--no-thinking'];
          const v = verbose ? ['--verbose'] : [];
          const argv = modelFirst
            ? [...m, ...t, ...v, ...q]
            : [...q, ...v, ...t, ...m];
          expect(parseCliArgs(argv)).toEqual({
            question,
            model,
            thinking,
            verbose,
          });
        },
      ),
    );
  });

  it('rejects any list that holds a stray positional word', () => {
    const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 3 }), (words) => {
        expect(() => parseCliArgs(['-q', 'hi', ...words])).toThrow(UsageError);
      }),
    );
  });

  it('throws nothing but a UsageError, for any argument list', () => {
    const token = fc.oneof(
      fc.string(),
      fc.constantFrom(
        '-q',
        '--model',
        '--',
        '-h',
        '--help',
        '-qfoo',
        '--model=x',
        '--q',
        '-',
      ),
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 6 }), (argv) => {
        try {
          parseCliArgs(argv);
        } catch (error) {
          expect(error).toBeInstanceOf(UsageError);
        }
      }),
    );
  });
});
