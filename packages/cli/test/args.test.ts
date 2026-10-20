import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/args.js';
import { UsageError } from '../src/errors.js';

describe('parseCliArgs', () => {
  it('returns nothing when no argument is given', () => {
    expect(parseCliArgs([])).toEqual({ question: undefined, model: undefined });
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
    });
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
    ['an unknown option', ['--verbose']],
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
        (question, model, modelFirst) => {
          const q = question === undefined ? [] : ['-q', question];
          const m = model === undefined ? [] : ['--model', model];
          const argv = modelFirst ? [...m, ...q] : [...q, ...m];
          expect(parseCliArgs(argv)).toEqual({ question, model });
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
