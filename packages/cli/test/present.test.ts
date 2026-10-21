import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPresenter } from '../src/present.js';
import type { AskEvent } from '../src/types.js';

const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const DONE: AskEvent = {
  kind: 'done',
  model: 'm',
  usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
};
const STATUS = 'model: m\ntokens: 1 prompt, 2 completion, 3 total\n';

const thinking = (text: string): AskEvent => ({ kind: 'thinking', text });
const content = (text: string): AskEvent => ({ kind: 'content', text });

interface Setup {
  verbose?: boolean;
  thinking?: boolean | undefined;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  noColor?: string | undefined;
}

const setup = ({
  verbose = false,
  thinking: flag,
  stdoutIsTTY = false,
  stderrIsTTY = false,
  noColor,
}: Setup = {}) => {
  const out = { stdout: '', stderr: '' };
  const presenter = createPresenter({
    stdout: {
      isTTY: stdoutIsTTY,
      write: (text) => {
        out.stdout += text;
      },
    },
    stderr: {
      isTTY: stderrIsTTY,
      write: (text) => {
        out.stderr += text;
      },
    },
    thinking: flag,
    verbose,
    noColor,
  });
  return {
    out,
    ...presenter,
    play: (...events: AskEvent[]) => {
      for (const event of events) {
        presenter.handle(event);
      }
    },
  };
};

describe('the answer', () => {
  it('writes each piece of answer text to stdout as it comes', () => {
    const { out, handle } = setup();
    handle(content('4'));
    expect(out.stdout).toBe('4');
    handle(content('2'));
    expect(out.stdout).toBe('42');
  });

  it('ends the answer with one newline, then writes the status lines to stderr', () => {
    const { out, play } = setup();
    play(content('42'), DONE);
    expect(out.stdout).toBe('42\n');
    expect(out.stderr).toBe(STATUS);
  });

  it('writes one newline even when the answer ends with one', () => {
    const { out, play } = setup();
    play(content('42\n'), DONE);
    expect(out.stdout).toBe('42\n\n');
  });

  it('writes stdout the concatenated answer plus one newline, however the text is cut up', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.string(), { maxLength: 6 }),
        fc.constantFrom(undefined, true, false),
        fc.boolean(),
        fc.boolean(),
        (pieces, thoughts, flag, stderrIsTTY, stdoutIsTTY) => {
          const { out, play } = setup({
            thinking: flag,
            stderrIsTTY,
            stdoutIsTTY,
          });
          play(...thoughts.map(thinking), ...pieces.map(content), DONE);
          expect(out.stdout).toBe(`${pieces.join('')}\n`);
        },
      ),
    );
  });
});

describe('when thinking is shown', () => {
  it.each([
    ['no flag, stderr a terminal', undefined, true, true],
    ['no flag, stderr not a terminal', undefined, false, false],
    ['--thinking, stderr a terminal', true, true, true],
    ['--thinking, stderr not a terminal', true, false, true],
    ['--no-thinking, stderr a terminal', false, true, false],
    ['--no-thinking, stderr not a terminal', false, false, false],
  ])('%s: shown is %s', (_name, flag, stderrIsTTY, shown) => {
    const { out, play } = setup({ thinking: flag, stderrIsTTY });
    play(thinking('hmm'), content('hi'), DONE);
    expect(out.stderr.includes('hmm')).toBe(shown);
    expect(out.stdout).toBe('hi\n');
  });

  it('never writes thinking to stdout', () => {
    const { out, play } = setup({ thinking: true, stdoutIsTTY: true });
    play(thinking('hmm'), content('hi'), DONE);
    expect(out.stdout).toBe('hi\n');
  });
});

describe('how thinking looks', () => {
  it('dims it on a terminal and ends the line before the answer', () => {
    const { out, play } = setup({ stderrIsTTY: true });
    play(thinking('a'), thinking('b'), content('X'), DONE);
    expect(out.stderr).toBe(`${DIM}ab${RESET}\n${STATUS}`);
  });

  it('adds a blank line before the answer when stdout is a terminal too', () => {
    const { out, play } = setup({ stderrIsTTY: true, stdoutIsTTY: true });
    play(thinking('ab'), content('X'), DONE);
    expect(out.stderr).toBe(`${DIM}ab${RESET}\n\n${STATUS}`);
  });

  it.each([
    ['a non-empty NO_COLOR', '1', `ab\n${STATUS}`],
    ['an empty NO_COLOR', '', `${DIM}ab${RESET}\n${STATUS}`],
    ['no NO_COLOR', undefined, `${DIM}ab${RESET}\n${STATUS}`],
  ])('with %s on a terminal', (_name, noColor, expected) => {
    const { out, play } = setup({ stderrIsTTY: true, noColor });
    play(thinking('ab'), content('X'), DONE);
    expect(out.stderr).toBe(expected);
  });

  it('writes plain text when stderr is not a terminal', () => {
    const { out, play } = setup({ thinking: true });
    play(thinking('ab'), content('X'), DONE);
    expect(out.stderr).toBe(`ab\n${STATUS}`);
  });

  it('does not add a newline when the thinking already ends its line', () => {
    const { out, play } = setup({ stderrIsTTY: true });
    play(thinking('a\n'), content('X'), DONE);
    expect(out.stderr).toBe(`${DIM}a\n${RESET}${STATUS}`);
  });

  it('writes the thinking as it comes, before the answer starts', () => {
    const { out, handle } = setup({ stderrIsTTY: true });
    handle(thinking('a'));
    expect(out.stderr).toBe(`${DIM}a`);
    handle(thinking('b'));
    expect(out.stderr).toBe(`${DIM}ab`);
    expect(out.stdout).toBe('');
  });

  it('does not touch stderr for thinking when it is hidden', () => {
    const { out, play } = setup({ stderrIsTTY: true, thinking: false });
    play(thinking('ab'), content('X'));
    expect(out.stderr).toBe('');
  });
});

describe('when the stream ends with thinking still open', () => {
  it('closes the thinking line before the status lines', () => {
    const { out, play } = setup({ stderrIsTTY: true });
    play(content('x'), thinking('late'), DONE);
    expect(out.stdout).toBe('x\n');
    expect(out.stderr).toBe(`${DIM}late${RESET}\n${STATUS}`);
  });

  it('adds no blank line before the status lines, even when stdout is a terminal', () => {
    const { out, play } = setup({ stderrIsTTY: true, stdoutIsTTY: true });
    play(content('x'), thinking('late'), DONE);
    expect(out.stderr).toBe(`${DIM}late${RESET}\n${STATUS}`);
  });
});

describe('when the stream fails', () => {
  it('closes an open thinking line and leaves stdout alone', () => {
    const { out, handle, interrupt } = setup({ stderrIsTTY: true });
    handle(thinking('hm'));
    interrupt();
    expect(out.stderr).toBe(`${DIM}hm${RESET}\n`);
    expect(out.stdout).toBe('');
  });

  it('ends an unfinished stdout line with one newline', () => {
    const { out, handle, interrupt } = setup();
    handle(content('Hel'));
    interrupt();
    expect(out.stdout).toBe('Hel\n');
  });

  it('adds no newline when the partial answer already ends its line', () => {
    const { out, handle, interrupt } = setup();
    handle(content('Hel\n'));
    interrupt();
    expect(out.stdout).toBe('Hel\n');
  });

  it('ends the unfinished answer line once, even when asked twice', () => {
    const { out, handle, interrupt } = setup();
    handle(content('Hel'));
    interrupt();
    interrupt();
    expect(out.stdout).toBe('Hel\n');
  });

  it('writes nothing when nothing was started', () => {
    const { out, interrupt } = setup({ stderrIsTTY: true });
    interrupt();
    expect(out).toEqual({ stdout: '', stderr: '' });
  });

  it('closes a thinking line that was cut off before any answer, with no blank line', () => {
    const { out, handle, interrupt } = setup({
      stderrIsTTY: true,
      stdoutIsTTY: true,
    });
    handle(thinking('hm'));
    interrupt();
    expect(out.stderr).toBe(`${DIM}hm${RESET}\n`);
  });

  it('closes the thinking line once, even when asked twice', () => {
    const { out, handle, interrupt } = setup({ stderrIsTTY: true });
    handle(thinking('hm'));
    interrupt();
    interrupt();
    expect(out.stderr).toBe(`${DIM}hm${RESET}\n`);
  });
});

const tool = (args: string, name = 'get_model'): AskEvent => ({
  kind: 'tool',
  name,
  arguments: args,
});

describe('tool calls', () => {
  it('writes nothing for a tool call without --verbose', () => {
    const { out, play } = setup();
    play(tool('{"slug":"a/b"}'));
    expect(out).toEqual({ stdout: '', stderr: '' });
  });

  it('writes one line to stderr per call with --verbose, and nothing to stdout', () => {
    const { out, play } = setup({ verbose: true });
    play(tool('{"slug":"a/b"}'), tool('{"slug":"c/d"}', 'other'));
    expect(out.stderr).toBe(
      'tool: get_model {"slug":"a/b"}\ntool: other {"slug":"c/d"}\n',
    );
    expect(out.stdout).toBe('');
  });

  it('shows the arguments as received, on one line', () => {
    const { out, play } = setup({ verbose: true });
    play(tool('{\n  "slug": "a/b"\n}'));
    expect(out.stderr).toBe('tool: get_model { "slug": "a/b" }\n');
  });

  it('cuts arguments longer than 200 characters with an ellipsis', () => {
    const { out, play } = setup({ verbose: true });
    play(tool('x'.repeat(201)));
    expect(out.stderr).toBe(`tool: get_model ${'x'.repeat(200)}…\n`);
  });

  it('cuts by character, never in the middle of a surrogate pair', () => {
    const { out, play } = setup({ verbose: true });
    play(tool('😀'.repeat(201)));
    expect(out.stderr).toBe(`tool: get_model ${'😀'.repeat(200)}…\n`);
  });

  it('keeps arguments of exactly 200 characters whole', () => {
    const { out, play } = setup({ verbose: true });
    play(tool('x'.repeat(200)));
    expect(out.stderr).toBe(`tool: get_model ${'x'.repeat(200)}\n`);
  });

  it('shows the line whether or not thinking is shown', () => {
    for (const flag of [true, false, undefined]) {
      const { out, play } = setup({ verbose: true, thinking: flag });
      play(tool('{}'));
      expect(out.stderr).toBe('tool: get_model {}\n');
    }
  });

  it('ends an open thinking line before it writes the tool line', () => {
    const { out, play } = setup({ verbose: true, thinking: true });
    play(thinking('let me look'), tool('{}'));
    expect(out.stderr).toBe('let me look\ntool: get_model {}\n');
  });

  it('closes the dimmed style before the tool line on a terminal, and dims later thinking again', () => {
    const { out, play } = setup({
      verbose: true,
      thinking: true,
      stderrIsTTY: true,
    });
    play(thinking('a'), tool('{}'), thinking('b'));
    expect(out.stderr).toBe(`${DIM}a${RESET}\ntool: get_model {}\n${DIM}b`);
  });

  it('leaves no blank line before the tool line when stdout is a terminal', () => {
    const { out, play } = setup({
      verbose: true,
      thinking: true,
      stdoutIsTTY: true,
    });
    play(thinking('a'), tool('{}'));
    expect(out.stderr).toBe('a\ntool: get_model {}\n');
  });

  it('writes no trailing space for a call without arguments', () => {
    const { out, play } = setup({ verbose: true });
    play(tool(''));
    expect(out.stderr).toBe('tool: get_model\n');
  });

  it('never writes more than one line per call, whatever the arguments', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (args, name) => {
        const { out, play } = setup({ verbose: true });
        play(tool(args, name.replace(/\s/g, '_')));
        expect(out.stderr.endsWith('\n')).toBe(true);
        expect(out.stderr.slice(0, -1)).not.toMatch(/[\r\n]/);
      }),
    );
  });
});
