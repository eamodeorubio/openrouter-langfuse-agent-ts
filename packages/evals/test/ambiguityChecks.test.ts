import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assumptionStated } from '../src/checks/assertions.js';

const success = (answer: string, toolCalls: unknown[] = []) => ({
  question: 'q',
  answer,
  success: true,
  toolCalls,
});
const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });
const vague = meta({ underspecified: true });
const claude = meta({ underspecified: true, assumes: 'anthropic/claude' });

describe('assumptionStated, for unstated-assumption', () => {
  it('passes an answer that asks something', () => {
    const result = assumptionStated(
      success('How many chats a day will it handle?'),
      vague,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The answer asks a question.');
  });

  it.each([
    'I assumed 1,000 chats a day.',
    'Assuming a mix of three to one.',
    'The cheapest one depends on your volume.',
    'If you tell me the volume I can narrow it.',
    'Based on typical chatbot traffic, use a/b.',
    "I'll take 3 input tokens per output token.",
    'I’ll take 3 input tokens per output token.',
    'It DEPENDS.',
  ])('passes an answer that states an assumption: %s', (answer) => {
    const result = assumptionStated(success(answer), vague);
    expect(result.pass, answer).toBe(true);
    expect(result.reason).toBe('The answer states an assumption.');
  });

  it('fails an answer that asks nothing and states no assumption', () => {
    const result = assumptionStated(success('Use a/b. It is cheap.'), vague);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer asks no question and states no assumption.',
    );
  });

  it('passes an answer that names a model with the assumed prefix, in any case', () => {
    for (const answer of [
      'Use anthropic/claude-haiku-5.5.',
      'USE ANTHROPIC/CLAUDE-HAIKU-5.5, it is small.',
    ]) {
      const result = assumptionStated(success(answer), claude);
      expect(result.pass, answer).toBe(true);
      expect(result.reason).toBe('The answer names the assumed model.');
    }
  });

  it('fails an answer that names another model when a model was to be assumed', () => {
    expect(
      assumptionStated(success('Use openai/gpt-oss-20b.'), claude).pass,
    ).toBe(false);
    expect(
      assumptionStated(success('Use xanthropic/claude-haiku.'), claude).pass,
    ).toBe(false);
  });

  it('passes a model with the assumed prefix among others, and fails a model when none was to be assumed', () => {
    expect(
      assumptionStated(
        success('Use openai/gpt-oss-20b or anthropic/claude-haiku-5.5.'),
        claude,
      ).pass,
    ).toBe(true);
    expect(
      assumptionStated(success('Use openai/gpt-oss-20b.'), vague).pass,
    ).toBe(false);
  });

  it('does not apply to a case that is not under-specified, or declares nothing', () => {
    expect(assumptionStated(success('Use a/b.'), meta({})).reason).toBe(
      'The question is not under-specified.',
    );
    expect(
      assumptionStated(success('Use a/b.'), meta({ underspecified: false }))
        .reason,
    ).toBe('The question is not under-specified.');
  });

  it('leaves a run that is no answer to an earlier class, and needs no lookup', () => {
    expect(assumptionStated(success('  '), vague).reason).toBe(
      'Left to an earlier class.',
    );
    expect(assumptionStated('not a run', vague).reason).toBe(
      'Left to an earlier class.',
    );
    expect(assumptionStated(success('What volume?', []), vague).pass).toBe(
      true,
    );
  });

  it('passes any answer that holds a question mark, whatever else it says', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (head, tail) => {
        expect(assumptionStated(success(`${head}?${tail}`), vague).pass).toBe(
          true,
        );
      }),
    );
  });
});
