import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCliArgs, requestedInfo, usageErrorOf } from '../src/args.js';
import { UsageError } from '../src/errors.js';

describe('parseCliArgs', () => {
  it('returns nothing when no argument is given', () => {
    expect(parseCliArgs([])).toEqual({
      question: undefined,
      model: undefined,
      thinking: undefined,
      verbose: false,
      json: false,
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
      json: false,
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

  it.each([
    ['--json', ['--json'], true],
    ['no flag', [], false],
  ])('reads %s as json = %s', (_name, argv, json) => {
    expect(parseCliArgs(argv).json).toBe(json);
  });

  it('lets --json go with the other flags', () => {
    expect(
      parseCliArgs(['--json', '-q', 'hi', '--verbose', '--no-thinking']),
    ).toMatchObject({
      question: 'hi',
      json: true,
      verbose: true,
      thinking: false,
    });
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
      json: false,
    });
  });

  it('reports a trailing -q as a missing value', () => {
    expect(() => parseCliArgs(['-q'])).toThrow(/^-q needs a value/);
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
        fc.boolean(),
        (question, model, modelFirst, thinking, verbose, json) => {
          const q = question === undefined ? [] : ['-q', question];
          const m = model === undefined ? [] : ['--model', model];
          const t =
            thinking === undefined
              ? []
              : [thinking ? '--thinking' : '--no-thinking'];
          const v = [
            ...(verbose ? ['--verbose'] : []),
            ...(json ? ['--json'] : []),
          ];
          const argv = modelFirst
            ? [...m, ...t, ...v, ...q]
            : [...q, ...v, ...t, ...m];
          expect(parseCliArgs(argv)).toEqual({
            question,
            model,
            thinking,
            verbose,
            json,
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

describe('requestedInfo', () => {
  it.each([
    [['--help'], 'help'],
    [['-h'], 'help'],
    [['--version'], 'version'],
    [['-v'], 'version'],
    [['-q', 'hi', '--version'], 'version'],
    [['--version', '--help'], 'help'],
    [['-v', '-h'], 'help'],
    [['--bogus', '--help'], 'help'],
  ])('finds %j', (argv, expected) => {
    expect(requestedInfo(argv)).toBe(expected);
  });

  it.each([
    ['no arguments', []],
    ['ordinary arguments', ['-q', 'hi', '--json']],
    ['the word as the question', ['-q', '--help']],
    ['the word as the model', ['--model', '-h']],
    ['the flag attached to -q', ['-q--help']],
    ['a longer flag', ['--helpful']],
  ])('finds nothing in %s', (_name, argv) => {
    expect(requestedInfo(argv)).toBeUndefined();
  });

  it('finds a flag wherever it stands among words that are not flags', () => {
    const word = fc
      .string()
      .filter(
        (text) =>
          !['-q', '--model', '-h', '--help', '-v', '--version'].includes(text),
      );
    fc.assert(
      fc.property(fc.array(word), fc.nat(), (words, at) => {
        const index = at % (words.length + 1);
        const put = (flag: string) => [
          ...words.slice(0, index),
          flag,
          ...words.slice(index),
        ];
        expect(requestedInfo(words)).toBeUndefined();
        expect(requestedInfo(put('--help'))).toBe('help');
        expect(requestedInfo(put('-v'))).toBe('version');
        expect(requestedInfo(put('-v').concat('--help'))).toBe('help');
      }),
    );
  });
});

describe('the messages of a usage error', () => {
  const message = (argv: string[]): string => {
    try {
      parseCliArgs(argv);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('did not throw');
  };

  it.each([
    [
      ['-q'],
      '-q needs a value, the question. Example: -q "What is a token?". Or leave -q out and pipe the question in.',
    ],
    [
      ['--q'],
      '-q needs a value, the question. Example: -q "What is a token?". Or leave -q out and pipe the question in.',
    ],
    [
      ['--model'],
      '--model needs a value, a model slug. Example: --model openai/gpt-4o-mini',
    ],
    [
      ['--model', '--verbose'],
      '--model needs a value, a model slug. Example: --model openai/gpt-4o-mini',
    ],
    [
      ['--nope'],
      "Unknown option '--nope'. The options this tool accepts are listed below.",
    ],
    [
      ['-z'],
      "Unknown option '-z'. The options this tool accepts are listed below.",
    ],
    [
      [''],
      "Unexpected argument ''. Quote the question and pass it with -q, or pipe it in.",
    ],
    [
      ["--a'b"],
      "Unknown option '--a'b'. The options this tool accepts are listed below.",
    ],
    [
      ['word'],
      "Unexpected argument 'word'. Quote the question and pass it with -q, or pipe it in.",
    ],
    [['--json=1'], '--json takes no value. Write --json alone.'],
    [['--thinking=yes'], '--thinking takes no value. Write --thinking alone.'],
    [
      ['--thinking', '--no-thinking'],
      'Use either --thinking or --no-thinking, not both. Remove one.',
    ],
  ])('is as the spec says for %j', (argv, expected) => {
    expect(message(argv)).toBe(expected);
  });

  it("never shows the parser's own words, for any list that fails", () => {
    const word = fc.stringMatching(/^-{0,2}[a-z]{0,6}(=[a-z]{0,3})?$/);
    fc.assert(
      fc.property(fc.array(word, { maxLength: 6 }), (argv) => {
        let text: string | undefined;
        try {
          parseCliArgs(argv);
        } catch (error) {
          text = (error as Error).message;
        }
        if (text !== undefined) {
          expect(text).not.toBe('');
          expect(text).not.toMatch(
            /Option '|To specify|argument missing|is ambiguous|does not take an argument|positional arguments/,
          );
        }
      }),
    );
  });
});

describe('usageErrorOf', () => {
  const failure = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  it.each([
    [
      'a code it does not know',
      failure('ERR_SOMETHING_NEW', "Option '--x' is odd"),
    ],
    [
      'a code it does not know, in words that name -q',
      failure('ERR_SOMETHING_NEW', "Option '-q, --q <value>' argument missing"),
    ],
    [
      'a code it does not know, in words that name --model',
      failure('ERR_SOMETHING_NEW', "Option '--model <value>' argument missing"),
    ],
    [
      'an unknown option with nothing quoted',
      failure('ERR_PARSE_ARGS_UNKNOWN_OPTION', 'Unknown option'),
    ],
    [
      'a positional with nothing quoted',
      failure('ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL', 'Unexpected argument'),
    ],
    [
      'a value error about another option',
      failure(
        'ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
        "Option '--other <value>' argument missing",
      ),
    ],
    [
      'a value error naming no option',
      failure('ERR_PARSE_ARGS_INVALID_OPTION_VALUE', 'Something about a value'),
    ],
  ])(
    "keeps the parser's message for %s, so that a newer Node cannot hide a failure",
    (_name, error) => {
      expect(usageErrorOf(error)).toBeInstanceOf(UsageError);
      expect(usageErrorOf(error).message).toBe(error.message);
    },
  );

  it.each([
    ['null', null, 'null'],
    ['a string', 'plain', 'plain'],
    ['an error without a code', new Error('boom'), 'boom'],
  ])('survives %s', (_name, thrown, message) => {
    expect(usageErrorOf(thrown).message).toBe(message);
  });
});
