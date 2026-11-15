import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arithmeticInHead,
  needlessLookup,
  statedCost,
} from '../src/checks/assertions.js';
import { CaseError } from '../src/checks/caseSpec.js';

const call = (name: string, failed = false) => ({
  round: 1,
  name,
  arguments: '{}',
  output: '{}',
  failed,
});

const success = (
  answer: string,
  toolCalls: ReturnType<typeof call>[] = [],
) => ({
  question: 'q',
  answer,
  success: true,
  toolCalls,
});

const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

describe('arithmetic-in-head', () => {
  const needs = meta({ needsArithmetic: true });

  it('fails a case that needs arithmetic when no calculate call succeeded', () => {
    const result = arithmeticInHead(
      success('It is $3.', [call('get_model')]),
      needs,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The case needs arithmetic and no calculate call succeeded.',
    );
    expect(
      arithmeticInHead(success('x', [call('calculate', true)]), needs).pass,
    ).toBe(false);
    expect(arithmeticInHead(success('x'), needs).pass).toBe(false);
  });

  it('passes when a calculate call succeeded, among any others', () => {
    const calls = [
      call('calculate', true),
      call('get_model'),
      call('calculate'),
    ];
    expect(arithmeticInHead(success('x', calls), needs).reason).toBe(
      'A calculate call succeeded.',
    );
    expect(arithmeticInHead(success('x', calls), needs).pass).toBe(true);
  });

  it('passes a case that does not need arithmetic', () => {
    expect(arithmeticInHead(success('x'), meta({})).reason).toBe(
      'The case needs no arithmetic.',
    );
    expect(
      arithmeticInHead(success('x'), meta({ needsArithmetic: false })).pass,
    ).toBe(true);
  });

  it('refuses a declaration that is not true or false, as a case that cannot be judged', () => {
    expect(() =>
      arithmeticInHead(success('x'), meta({ needsArithmetic: 'yes' })),
    ).toThrow(CaseError);
  });

  it('leaves a run with no answer to run-failed', () => {
    expect(arithmeticInHead(success(' '), needs).reason).toBe(
      'Left to run-failed.',
    );
    expect(arithmeticInHead(undefined, needs).pass).toBe(true);
  });

  it('does not wait for a lookup: it judges a run that made none', () => {
    expect(arithmeticInHead(success('$3'), needs).pass).toBe(false);
  });
});

describe('needless-lookup', () => {
  const given = meta({ needsLookup: false });

  it.each(['get_model', 'search_models'])(
    'fails a case whose data was given when the run called %s',
    (name) => {
      const result = needlessLookup(success('x', [call(name)]), given);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(
        `The question held the data, and the run called ${name}.`,
      );
    },
  );

  it('counts a lookup that failed as a lookup', () => {
    expect(
      needlessLookup(success('x', [call('get_model', true)]), given).pass,
    ).toBe(false);
  });

  it('names every lookup the run made, once each', () => {
    const calls = [
      call('search_models'),
      call('get_model'),
      call('get_model'),
      call('calculate'),
    ];
    expect(needlessLookup(success('x', calls), given).reason).toBe(
      'The question held the data, and the run called search_models, get_model.',
    );
  });

  it('passes a run that only calculated', () => {
    expect(
      needlessLookup(success('x', [call('calculate')]), given).reason,
    ).toBe('The run made no lookup.');
    expect(needlessLookup(success('x'), given).pass).toBe(true);
  });

  it('passes a case that needs a lookup, and one that says nothing', () => {
    const lookup = success('x', [call('get_model')]);
    expect(needlessLookup(lookup, meta({ needsLookup: true })).reason).toBe(
      'The case may look data up.',
    );
    expect(needlessLookup(lookup, meta({})).pass).toBe(true);
  });

  it('leaves a run with no answer to run-failed', () => {
    expect(needlessLookup(success('', [call('get_model')]), given).reason).toBe(
      'Left to run-failed.',
    );
  });
});

describe('the cost an answer states, for wrong-value', () => {
  const asks = meta({ expectedCost: 3, needsLookup: false });

  it('passes an answer with the amount, in dollars or in USD, within one percent', () => {
    expect(statedCost(success('That costs $3.00.'), asks).pass).toBe(true);
    expect(statedCost(success('3.02 USD in total'), asks).pass).toBe(true);
    expect(statedCost(success('That costs $3.00.'), asks).reason).toBe(
      'The answer states an amount within 1% of 3.',
    );
  });

  it('fails an answer without it, and says what it expected', () => {
    const result = statedCost(success('That costs $4.00 and 3 tokens.'), asks);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('The answer states no amount within 1% of 3.');
  });

  it('passes a case that expects no cost', () => {
    expect(statedCost(success('x'), meta({})).reason).toBe(
      'The case expects no cost.',
    );
  });

  it('leaves a run with no answer to run-failed', () => {
    expect(statedCost(success(''), asks).reason).toBe('Left to run-failed.');
  });

  it('leaves a case that needs a lookup, and made none, to memory-answer', () => {
    const lookup = meta({ expectedCost: 3, needsLookup: true });
    expect(statedCost(success('$9'), lookup).reason).toBe(
      'Left to memory-answer.',
    );
    expect(statedCost(success('$9', [call('get_model')]), lookup).pass).toBe(
      false,
    );
    expect(
      statedCost(success('$9', [call('get_model', true)]), lookup).pass,
    ).toBe(true);
  });
});

describe('the tool-use checks, for any output and any case', () => {
  it('never throw and return a verdict', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [arithmeticInHead, needlessLookup, statedCost]) {
          try {
            const result = check(output, context as never);
            expect(typeof result.pass).toBe('boolean');
            expect(result.score).toBe(result.pass ? 1 : 0);
            expect(result.reason).not.toBe('');
          } catch (error) {
            // Only a case that declares something unreadable may fail.
            expect(error).toBeInstanceOf(CaseError);
          }
        }
      }),
    );
  });
});

describe('a cost the case cannot compare with', () => {
  it.each([[Number.POSITIVE_INFINITY], [Number.NaN], ['3'], [null]])(
    'is refused as a declaration: %s',
    (expectedCost) => {
      expect(() => statedCost(success('$9'), meta({ expectedCost }))).toThrow(
        CaseError,
      );
      expect(() => statedCost(success('$9'), meta({ expectedCost }))).toThrow(
        /expectedCost of a case must be a finite number/,
      );
    },
  );
});

describe('the tool-use checks, for any output and any case', () => {
  it('never throw and return a verdict', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [arithmeticInHead, needlessLookup, statedCost]) {
          try {
            const result = check(output, context as never);
            expect(typeof result.pass).toBe('boolean');
            expect(result.score).toBe(result.pass ? 1 : 0);
            expect(result.reason).not.toBe('');
          } catch (error) {
            // Only a case that declares something unreadable may fail.
            expect(error).toBeInstanceOf(CaseError);
          }
        }
      }),
    );
  });
});
