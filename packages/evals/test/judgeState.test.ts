import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  grounding,
  relevance,
  stateBytes,
  toolUsage,
  usefulness,
} from '../src/judge/state.js';

const call = (
  name: string,
  args: string,
  output: string,
  failed = false,
  round = 1,
) => ({ round, name, arguments: args, output, failed });

const run = {
  question: 'What does a/b cost?',
  answer: 'a/b costs $1 per million tokens.',
  success: true,
  toolCalls: [
    call('get_model', '{"slug":"a/b"}', '{"id":"a/b","pricing":{"prompt":1}}'),
    call('get_model', '{"slug":"c/d"}', 'not found', true, 2),
  ],
};

describe('the state of judge-grounding', () => {
  it('holds the tool calls with arguments and outputs, and the answer, and not the question', () => {
    expect(grounding(run, {})).toBe(
      [
        'Tool calls:',
        '1. get_model (round 1) {"slug":"a/b"}',
        '   Output: {"id":"a/b","pricing":{"prompt":1}}',
        '2. get_model (round 2, failed) {"slug":"c/d"}',
        '   Output: not found',
        '',
        'Answer: a/b costs $1 per million tokens.',
      ].join('\n'),
    );
  });
});

describe('the state of judge-relevance and judge-usefulness', () => {
  const expected = [
    'Question: What does a/b cost?',
    '',
    'Tool calls:',
    '1. get_model (round 1) {"slug":"a/b"}',
    '2. get_model (round 2, failed) {"slug":"c/d"}',
    '',
    'Answer: a/b costs $1 per million tokens.',
  ].join('\n');

  it('hold the question, the tool calls with their arguments, and the answer, and no outputs', () => {
    expect(relevance(run, {})).toBe(expected);
    expect(usefulness(run, {})).toBe(expected);
  });
});

describe('the state of judge-tool-usage', () => {
  it('holds the question and the tool calls with their arguments, and not the answer', () => {
    expect(toolUsage(run, {})).toBe(
      [
        'Question: What does a/b cost?',
        '',
        'Tool calls:',
        '1. get_model (round 1) {"slug":"a/b"}',
        '2. get_model (round 2, failed) {"slug":"c/d"}',
      ].join('\n'),
    );
  });
});

describe('the states of a run', () => {
  const none = { ...run, toolCalls: [] };

  it('say that there were no tool calls', () => {
    expect(relevance(none, {})).toContain('Tool calls: none.');
    expect(grounding(none, {})).toContain('Tool calls: none.');
    expect(toolUsage(none, {})).toContain('Tool calls: none.');
  });

  it('read the question from the context when the output reports none', () => {
    const quiet = { ...none, question: undefined };
    expect(relevance(quiet, { vars: { question: 'From vars?' } })).toContain(
      'Question: From vars?',
    );
    expect(relevance(quiet, {})).toContain('Question: (not reported)');
    for (const question of ['', 3, null]) {
      expect(relevance(quiet, { vars: { question } })).toContain(
        'Question: (not reported)',
      );
    }
  });

  it('hold a very long answer whole', () => {
    const long = 'word '.repeat(20_000);
    expect(relevance({ ...run, answer: long }, {})).toContain(long);
  });

  it('are measured in bytes, not in characters', () => {
    expect(stateBytes('abc')).toBe(3);
    expect(stateBytes('é€')).toBe(5);
    expect(stateBytes('')).toBe(0);
  });

  it('hold the answer, never throw, and give the same text for the same run', () => {
    fc.assert(
      fc.property(fc.anything(), (output) => {
        for (const build of [grounding, relevance, usefulness, toolUsage]) {
          expect(typeof build(output, undefined)).toBe('string');
          expect(build(output, {})).toBe(build(output, {}));
        }
      }),
    );
    fc.assert(
      fc.property(fc.string(), (answer) => {
        expect(grounding({ ...run, answer }, {})).toContain(answer);
        expect(relevance({ ...run, answer }, {})).toContain(answer);
        expect(usefulness({ ...run, answer }, {})).toContain(answer);
      }),
    );
  });
});
