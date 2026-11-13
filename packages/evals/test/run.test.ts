import { describe, expect, it } from 'vitest';
import {
  asSuccess,
  isBlank,
  lookupMade,
  successfulCalls,
} from '../src/checks/run.js';

const call = (over: Record<string, unknown> = {}) => ({
  round: 1,
  name: 'get_model',
  arguments: '{}',
  output: '{}',
  failed: false,
  ...over,
});

describe('the success object of a run', () => {
  it('is read from the output of the CLI', () => {
    expect(
      asSuccess({
        success: true,
        question: 'q',
        answer: 'a',
        toolCalls: [call()],
      }),
    ).toEqual({ question: 'q', answer: 'a', toolCalls: [call()] });
  });

  it.each([
    ['text', 'plain'],
    ['null', null],
    ['a list', []],
    ['an object that is not a success', { success: false, answer: 'a' }],
    ['a success without success: true', { answer: 'a' }],
    ['a success with success as text', { success: 'true', answer: 'a' }],
    ['a success without an answer', { success: true }],
    ['a success with an answer that is not text', { success: true, answer: 3 }],
  ])('is nothing for %s', (_, output) => {
    expect(asSuccess(output)).toBeUndefined();
  });

  it('has an empty question and no calls when the CLI sent none', () => {
    expect(asSuccess({ success: true, answer: 'a' })).toEqual({
      question: '',
      answer: 'a',
      toolCalls: [],
    });
    expect(
      asSuccess({ success: true, answer: 'a', question: 4, toolCalls: 'x' }),
    ).toEqual({ question: '', answer: 'a', toolCalls: [] });
  });

  it('keeps only the calls that have the fields of a call', () => {
    const output = {
      success: true,
      answer: 'a',
      toolCalls: [
        call({ name: 'good' }),
        null,
        'text',
        call({ name: 3 }),
        call({ arguments: 3 }),
        call({ output: 3 }),
        call({ failed: 'no' }),
        { name: 'only name' },
      ],
    };
    expect(asSuccess(output)?.toolCalls.map((c) => c.name)).toEqual(['good']);
  });
});

describe('what a run did', () => {
  const run = (...flags: boolean[]) => ({
    question: 'q',
    answer: 'a',
    toolCalls: flags.map((failed) => call({ failed })),
  });

  it('made a lookup when a call succeeded', () => {
    expect(lookupMade(run(true, false))).toBe(true);
    expect(lookupMade(run(true, true))).toBe(false);
    expect(lookupMade(run())).toBe(false);
    expect(successfulCalls(run(true, false, false))).toHaveLength(2);
  });

  it('is blank when the answer is only space', () => {
    expect(isBlank({ ...run(), answer: ' \n\t' })).toBe(true);
    expect(isBlank({ ...run(), answer: ' a ' })).toBe(false);
    expect(isBlank({ ...run(), answer: '' })).toBe(true);
  });
});
