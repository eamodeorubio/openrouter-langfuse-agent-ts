import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readQuestion } from '../src/input.js';

const stdin = (text: string, isTTY = false) => {
  const state = { reads: 0 };
  return {
    state,
    source: {
      isTTY,
      read: async () => {
        state.reads++;
        return text;
      },
    },
  };
};

describe('readQuestion', () => {
  it('returns the trimmed -q text without touching stdin', async () => {
    const { source, state } = stdin('from stdin');
    expect(await readQuestion('  from flag \n', source)).toBe('from flag');
    expect(state.reads).toBe(0);
  });

  it('reads and trims stdin when there is no -q', async () => {
    const { source } = stdin('What is a token?\n');
    expect(await readQuestion(undefined, source)).toBe('What is a token?');
  });

  it('does not fall back to stdin when -q is blank', async () => {
    const { source, state } = stdin('from stdin');
    await expect(readQuestion('  ', source)).rejects.toThrow(/-q is empty/);
    expect(state.reads).toBe(0);
  });

  it('does not read a terminal', async () => {
    const { source, state } = stdin('typed', true);
    await expect(readQuestion(undefined, source)).rejects.toThrow(/pipe it in/);
    expect(state.reads).toBe(0);
  });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['newlines and tabs', '\n\t\n'],
  ])('rejects %s on stdin', async (_name, text) => {
    await expect(readQuestion(undefined, stdin(text).source)).rejects.toThrow(
      /Standard input is empty/,
    );
  });

  it('keeps inner whitespace and newlines', async () => {
    expect(
      await readQuestion(undefined, stdin('line one\n\nline  two\n').source),
    ).toBe('line one\n\nline  two');
  });

  it('returns the trimmed text for any non-blank input, from either source', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => s.trim() !== ''),
        async (text) => {
          expect(await readQuestion(text, stdin('ignored').source)).toBe(
            text.trim(),
          );
          expect(await readQuestion(undefined, stdin(text).source)).toBe(
            text.trim(),
          );
        },
      ),
    );
  });
});
