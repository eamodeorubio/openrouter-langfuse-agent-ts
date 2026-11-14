import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  modelsRead,
  noPriceStated,
  saysFree,
  saysNoFixedPrice,
  withinBudget,
  workloadCost,
} from '../src/checks/assertions.js';
import { CaseError } from '../src/checks/caseSpec.js';
import {
  matchesCount,
  matchesRatio,
  statesNonZeroPrice,
  statesPrice,
} from '../src/checks/figures.js';
import { catalogModel, snapshotFile } from './oracleFixture.js';

interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const read = (
  id: string,
  prompt: number | null,
  completion: number | null,
  failed = false,
): Call => ({
  round: 1,
  name: 'get_model',
  arguments: JSON.stringify({ slug: id }),
  output: JSON.stringify({
    id,
    context_length: 1000,
    pricing: { prompt, completion },
  }),
  failed,
});

const success = (answer: string, toolCalls: Call[], question = 'q') => ({
  question,
  answer,
  success: true,
  toolCalls,
});
const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

const CHATBOT = {
  chatsPerDay: 2000,
  inputTokens: 1500,
  outputTokens: 400,
  days: 30,
};

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = () =>
  vi.stubEnv(
    'EVAL_CATALOG',
    snapshotFile([
      catalogModel('a/b', 100_000, true, 1, 4),
      catalogModel('c/d', 100_000, true, 2, 8),
      catalogModel('e/f', 100_000, true, 0.5, 1),
      catalogModel('r/auto', 100_000, true, null, null),
    ]),
  );

describe('withinBudget, for bad-recommendation', () => {
  const chatbot = meta({
    oracle: {
      query: 'within-budget',
      params: {
        workload: CHATBOT,
        budget: 300,
        supportedParameters: ['tools'],
      },
    },
  });
  const looked = [read('a/b', 1, 4)];

  it('passes an answer that names a model within the budget', () => {
    withSnapshot();
    const result = withinBudget(
      success('Use a/b, at 186 USD a month.', looked),
      chatbot,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The answer names a model within the budget.');
    expect(
      withinBudget(success('c/d is dear, e/f is cheap.', looked), chatbot).pass,
    ).toBe(true);
  });

  it('fails an answer that names only models over the budget, or none, and lists the models that fit', () => {
    withSnapshot();
    for (const answer of ['Use c/d.', 'Any model will do.']) {
      const result = withinBudget(success(answer, looked), chatbot);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(
        'The answer names no model within the budget: a/b, e/f.',
      );
    }
  });

  it('asks for an alternative when the question names a model, and does not count that model', () => {
    withSnapshot();
    const ask = 'Is a/b affordable? What else could I use?';
    expect(withinBudget(success('Use a/b.', looked, ask), chatbot).pass).toBe(
      false,
    );
    expect(
      withinBudget(success('Use a/b or e/f.', looked, ask), chatbot).pass,
    ).toBe(true);
  });

  it('passes when no model of the snapshot fits, which no run could name', () => {
    withSnapshot();
    const poor = meta({
      oracle: {
        query: 'within-budget',
        params: { workload: CHATBOT, budget: 1 },
      },
    });
    expect(withinBudget(success('Use a/b.', looked), poor).reason).toBe(
      'The snapshot holds no model within the budget.',
    );
  });

  it('passes a case with no oracle, and leaves a run with no lookup or no answer to earlier classes', () => {
    withSnapshot();
    expect(withinBudget(success('x', looked), meta({})).reason).toBe(
      'No oracle query.',
    );
    expect(withinBudget(success('x', []), chatbot).reason).toBe(
      'Left to an earlier class.',
    );
    expect(withinBudget(success('', looked), chatbot).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('modelsRead, for wrong-search', () => {
  const ask = 'What does a/b cost per month, and c/d?';

  it('passes when a successful call read every model the question names', () => {
    withSnapshot();
    const result = modelsRead(
      success('x', [read('a/b', 1, 4), read('c/d', 2, 8)], ask),
      meta({}),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'A tool output holds every model of the question.',
    );
  });

  it('fails and names the models no output held, ignoring a call that failed', () => {
    withSnapshot();
    const result = modelsRead(
      success('x', [read('a/b', 1, 4), read('c/d', 2, 8, true)], ask),
      meta({}),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('No tool output holds c/d.');
  });

  it('takes only models of the snapshot for models of the question, in any case', () => {
    withSnapshot();
    expect(
      modelsRead(
        success('x', [read('a/b', 1, 4)], 'About A/B and x/y?'),
        meta({}),
      ).pass,
    ).toBe(true);
    expect(() =>
      modelsRead(success('x', [read('a/b', 1, 4)], 'No model here.'), meta({})),
    ).toThrow(CaseError);
    expect(() =>
      modelsRead(success('x', [read('a/b', 1, 4)], 'No model here.'), meta({})),
    ).toThrow(/names no model of the snapshot/);
  });

  it('leaves a run with no lookup or no answer to earlier classes', () => {
    withSnapshot();
    expect(
      modelsRead(
        success('x', [read('e/f', 1, 4)], 'Compare a/b and c/d.'),
        meta({}),
      ).reason,
    ).toBe('No tool output holds a/b, c/d.');
    expect(modelsRead(success('x', [], ask), meta({})).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('workloadCost, for wrong-value', () => {
  const costs = meta({ workload: CHATBOT });
  const one = 'What does a/b cost a month for 2,000 chats a day?';
  const two = 'Compare a/b and e/f for the chatbot.';

  it('passes an answer that states the monthly cost of the model, in dollars, within one percent', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4)];
    const result = workloadCost(
      success('It costs $186.00 a month.', calls, one),
      costs,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer states the monthly cost of every model: 186.00.',
    );
    expect(
      workloadCost(success('About 187.5 USD.', calls, one), costs).pass,
    ).toBe(true);
  });

  it('fails an answer without it, and says the cost it expected', () => {
    withSnapshot();
    const result = workloadCost(
      success('It costs $200 a month.', [read('a/b', 1, 4)], one),
      costs,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer states no amount within 1% of the monthly cost of a/b: 186.00.',
    );
  });

  it('asks for the cost of each model, and the ratio between them, in either orientation', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4), read('e/f', 0.5, 1)];
    const good = success(
      'a/b costs $186.00 and e/f $69.00, so a/b costs 2.7 times as much.',
      calls,
      two,
    );
    expect(workloadCost(good, costs).pass).toBe(true);
    expect(
      workloadCost(
        success('$186.00 and $69.00: e/f costs 0.37x of a/b.', calls, two),
        costs,
      ).pass,
    ).toBe(true);
    const noRatio = workloadCost(
      success('a/b costs $186.00 and e/f $69.00.', calls, two),
      costs,
    );
    expect(noRatio.pass).toBe(false);
    expect(noRatio.reason).toBe(
      'The answer states no ratio within 1% of 2.70 or 0.37 between the costs of a/b and e/f.',
    );
    const missing = workloadCost(
      success('a/b costs $186.00. Ratio 2.7x.', calls, two),
      costs,
    );
    expect(missing.reason).toBe(
      'The answer states no amount within 1% of the monthly cost of e/f: 69.00.',
    );
  });

  it('names every model that is missing, and lists every cost it found', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4), read('e/f', 0.5, 1)];
    expect(workloadCost(success('Nothing.', calls, two), costs).reason).toBe(
      'The answer states no amount within 1% of the monthly cost of a/b: 186.00. The answer states no amount within 1% of the monthly cost of e/f: 69.00.',
    );
    expect(
      workloadCost(success('$186.00, $69.00, 2.7x.', calls, two), costs).reason,
    ).toBe('The answer states the monthly cost of every model: 186.00, 69.00.');
  });

  it('asks for no ratio when the question names three models', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4), read('c/d', 2, 8), read('e/f', 0.5, 1)];
    expect(
      workloadCost(
        success('$186.00, $372.00 and $69.00.', calls, 'a/b, c/d and e/f?'),
        costs,
      ).pass,
    ).toBe(true);
  });

  it('judges no ratio when a cost is zero, whichever model the question names first', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4), read('c/d', 0, 0)];
    expect(
      workloadCost(success('$0 and $186.00', calls, 'c/d versus a/b'), costs)
        .pass,
    ).toBe(true);
  });

  it('leaves a run that read only some models of the question to wrong-search', () => {
    withSnapshot();
    expect(
      workloadCost(success('x', [read('a/b', 1, 4)], `${two} e/f`), costs)
        .reason,
    ).toBe('Left to wrong-search.');
    expect(
      workloadCost(success('x', [read('a/b', null, 4)], 'a/b'), costs).reason,
    ).toBe(
      'The tools returned no price for a/b: left to invented-data and wrong-value.',
    );
  });

  it('judges no ratio when a cost is zero', () => {
    withSnapshot();
    const calls = [read('a/b', 1, 4), read('c/d', 0, 0)];
    const result = workloadCost(
      success('$186.00 and 0 dollars... $0', calls, 'a/b versus c/d'),
      costs,
    );
    expect(result.pass).toBe(true);
  });

  it('passes a case with no workload, and leaves a run that did not read the models, or a model with no price, to wrong-search', () => {
    withSnapshot();
    expect(
      workloadCost(success('x', [read('a/b', 1, 4)], one), meta({})).reason,
    ).toBe('No workload.');
    expect(
      workloadCost(success('x', [read('c/d', 2, 8)], one), costs).reason,
    ).toBe('Left to wrong-search.');
    expect(
      workloadCost(success('x', [read('a/b', 1, null)], one), costs).reason,
    ).toBe(
      'The tools returned no price for a/b: left to invented-data and wrong-value.',
    );
    expect(workloadCost(success('x', [], one), costs).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('noPriceStated, for invented-data', () => {
  const router = 'What does r/auto cost per million tokens?';

  it('passes an answer that states no price for a model with no price', () => {
    withSnapshot();
    const result = noPriceStated(
      success(
        'It has no fixed price: it routes to other models.',
        [read('r/auto', null, null)],
        router,
      ),
      meta({}),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer states no price for a model that has none.',
    );
  });

  it('fails an answer that states one, as an amount in dollars or USD or a number per million', () => {
    withSnapshot();
    for (const answer of [
      'It costs $2 per million.',
      'About 2 USD.',
      'Roughly 3 per million tokens.',
    ]) {
      const result = noPriceStated(
        success(answer, [read('r/auto', null, null)], router),
        meta({}),
      );
      expect(result.pass, answer).toBe(false);
      expect(result.reason).toBe(
        'The tools returned no price for r/auto, and the answer states one.',
      );
    }
  });

  it('counts a model with only one price as priced', () => {
    withSnapshot();
    for (const call of [read('a/b', 1, null), read('a/b', null, 4)]) {
      expect(
        noPriceStated(success('$1', [call], 'What does a/b cost?'), meta({}))
          .reason,
      ).toBe('The tools returned a price, so the case does not apply.');
      expect(
        saysNoFixedPrice(success('x', [call], 'What does a/b cost?'), meta({}))
          .reason,
      ).toBe('The case does not apply.');
    }
  });

  it('does not apply when the tools returned a price, and leaves an unread model to wrong-search', () => {
    withSnapshot();
    const priced = noPriceStated(
      success('$1 per million', [read('a/b', 1, 4)], 'What does a/b cost?'),
      meta({}),
    );
    expect(priced.reason).toBe(
      'The tools returned a price, so the case does not apply.',
    );
    expect(
      noPriceStated(
        success('$1', [read('c/d', 2, 8)], 'What does a/b cost?'),
        meta({}),
      ).reason,
    ).toBe('Left to wrong-search.');
    expect(() =>
      noPriceStated(success('x', [read('a/b', 1, 4)], 'No model.'), meta({})),
    ).toThrow(CaseError);
    expect(
      noPriceStated(
        success('x', [read('a/b', null, null)], 'What do a/b and c/d cost?'),
        meta({}),
      ).reason,
    ).toBe('Left to wrong-search.');
    expect(noPriceStated(success('x', [], router), meta({})).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('saysNoFixedPrice, for wrong-value', () => {
  const router = 'What does r/auto cost per million tokens?';
  const calls = [read('r/auto', null, null)];

  it.each([
    'It has no fixed price.',
    'It has no listed price.',
    'It has no set price.',
    'It has no published pricing.',
    'The price is not fixed.',
    'Pricing is not published.',
    'It does not have a price.',
    "It doesn't have a fixed price.",
    "There isn't a single price.",
    'There is no single price.',
    'The cost depends on the model it picks.',
    'The price varies with the model it picks.',
    'It depends on the model it routes to.',
    'The price is variable.',
    'Pricing is dynamic.',
    'It routes your request to another model.',
  ])('passes an answer that says so: %s', (answer) => {
    withSnapshot();
    const result = saysNoFixedPrice(success(answer, calls, router), meta({}));
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer says that the model has no fixed price.',
    );
  });

  it.each([
    'It is a good model.',
    'It routes requests quickly.',
    'It depends on the weather.',
    'Choose it for speed. Pricing is on the page.',
  ])('fails an answer that does not say so: %s', (answer) => {
    withSnapshot();
    expect(
      saysNoFixedPrice(success(answer, calls, router), meta({})).pass,
    ).toBe(false);
  });

  it('fails an answer that does not say so, and names the model', () => {
    withSnapshot();
    const result = saysNoFixedPrice(
      success('It is a good model.', calls, router),
      meta({}),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The tools returned no price for r/auto, and the answer does not say that it has none.',
    );
  });

  it('does not apply to a model with a price, and leaves unread models and runs with no lookup to earlier classes', () => {
    withSnapshot();
    expect(
      saysNoFixedPrice(
        success('x', [read('a/b', 1, 4)], 'What does a/b cost?'),
        meta({}),
      ).reason,
    ).toBe('The case does not apply.');
    expect(
      saysNoFixedPrice(success('x', [read('c/d', 2, 8)], router), meta({}))
        .reason,
    ).toBe('Left to wrong-search.');
    expect(saysNoFixedPrice(success('x', [], router), meta({})).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('saysFree, for wrong-value', () => {
  const ask = 'What does f/one:free cost per million tokens?';
  const calls = [read('f/one:free', 0, 0)];
  const withFree = () =>
    vi.stubEnv(
      'EVAL_CATALOG',
      snapshotFile([
        catalogModel('f/one:free', 1000, true, 0, 0),
        catalogModel('a/b', 1000, true, 1, 4),
      ]),
    );

  it.each([
    'It is free.',
    'It costs nothing: no cost at all.',
    'The price is zero.',
    'It costs 0 USD per million tokens.',
    'It costs $0 and $0.00 per million tokens.',
    'f/one:free is free to use, at $0 per million tokens.',
    'It costs $0/1M tokens.',
    'The price is zero.',
    'It costs zero.',
    'The cost is zero for both.',
    'Zero cost, input and output. Feel free to use f/one:free.',
  ])('passes an answer that says it is free: %s', (answer) => {
    withFree();
    const result = saysFree(success(answer, calls, ask), meta({}));
    expect(result.pass, answer).toBe(true);
    expect(result.reason).toBe('The answer says that the model is free.');
  });

  it.each([
    'It costs $0.20 per million tokens.',
    'It is free, but the output costs 0.3 USD.',
    'Free input, then 2 per million tokens of output.',
  ])('fails an answer that holds a price that is not zero: %s', (answer) => {
    withFree();
    const result = saysFree(success(answer, calls, ask), meta({}));
    expect(result.pass, answer).toBe(false);
    expect(result.reason).toBe(
      'The tools returned prices of 0 for f/one:free, and the answer states a price that is not zero.',
    );
  });

  it('does not read a slug as the word, whichever characters, case or company it has', () => {
    vi.stubEnv(
      'EVAL_CATALOG',
      snapshotFile([
        catalogModel('f/x.free', 1000, true, 0, 0),
        catalogModel('f/two:free', 1000, true, 0, 0),
        catalogModel('f/one:free', 1000, true, 0, 0),
      ]),
    );
    const bad = (answer: string, question: string, slugs: string[]) =>
      saysFree(
        success(
          answer,
          slugs.map((id) => read(id, 0, 0)),
          question,
        ),
        meta({}),
      ).pass;
    expect(bad('f/x.free is a good model.', 'f/x.free?', ['f/x.free'])).toBe(
      false,
    );
    // A dot in a slug is a dot, and no stand-in for a space: the word after it stays.
    expect(bad('Use f/x free of charge.', 'f/x.free?', ['f/x.free'])).toBe(
      true,
    );
    expect(
      bad('f/one:free and f/two:free are good.', 'f/one:free and f/two:free?', [
        'f/one:free',
        'f/two:free',
      ]),
    ).toBe(false);
    expect(bad('F/ONE:FREE is good.', 'f/one:free?', ['f/one:free'])).toBe(
      false,
    );
    expect(bad('frf/one:freeee', 'f/one:free?', ['f/one:free'])).toBe(false);
  });

  it('gives the reason when a negation takes the word back', () => {
    withFree();
    expect(
      saysFree(success('It is not free.', calls, ask), meta({})).reason,
    ).toBe(
      'The tools returned prices of 0 for f/one:free, and the answer does not say that it is free.',
    );
  });

  it.each([
    'It is not free.',
    "It isn't really free.",
    'It is never free.',
    'Feel free to ask me more, f/one:free is a good model.',
    'It supports zero-shot prompts.',
  ])(
    'fails an answer whose free is a negation, an invitation or another word: %s',
    (answer) => {
      withFree();
      expect(saysFree(success(answer, calls, ask), meta({})).pass, answer).toBe(
        false,
      );
    },
  );

  it('fails an answer that does not say the model is free, and does not take the slug for the word', () => {
    withFree();
    const result = saysFree(
      success('f/one:free is a good model.', calls, ask),
      meta({}),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The tools returned prices of 0 for f/one:free, and the answer does not say that it is free.',
    );
  });

  it('does not apply to a model with a price, and leaves unread models and runs with no lookup to earlier classes', () => {
    withFree();
    expect(
      saysFree(
        success('x', [read('a/b', 1, 4)], 'What does a/b cost?'),
        meta({}),
      ).reason,
    ).toBe('The case does not apply.');
    expect(
      saysFree(success('x', [read('a/b', 1, 4)], ask), meta({})).reason,
    ).toBe('Left to wrong-search.');
    expect(saysFree(success('x', [], ask), meta({})).reason).toBe(
      'Left to an earlier class.',
    );
    expect(() =>
      saysFree(success('x', calls, 'No model here.'), meta({})),
    ).toThrow(CaseError);
  });

  it('counts a model with one price of 0 and the other above 0 as not free', () => {
    withFree();
    for (const [input, output] of [
      [0, 4],
      [3, 0],
    ] as const) {
      expect(
        saysFree(
          success('x', [read('f/one:free', input, output)], ask),
          meta({}),
        ).reason,
      ).toBe('The case does not apply.');
    }
  });

  it('counts a model with one price of 0 and one missing as not free', () => {
    withFree();
    expect(
      saysFree(success('x', [read('f/one:free', 0, null)], ask), meta({}))
        .reason,
    ).toBe('The case does not apply.');
  });
});

describe('the figures of a ratio and of a price', () => {
  it('statesNonZeroPrice reads an amount above zero, marked or per million', () => {
    for (const text of [
      '$0.20',
      '0.3 USD',
      '2 per million tokens',
      '$5',
      '1 USD per 1M',
      '1,000 per million tokens',
      '3 PER MILLION TOKENS',
    ]) {
      expect(statesNonZeroPrice(text), text).toBe(true);
    }
    for (const text of [
      'free',
      '$0',
      '$0.00',
      '0 USD',
      '0.0 per million tokens',
      'version 5',
      '3 million tokens',
    ]) {
      expect(statesNonZeroPrice(text), text).toBe(false);
    }
  });

  it('matchesRatio reads a number, with or without a times sign, within one percent', () => {
    expect(matchesRatio('about 2.7x as much', 2.6957)).toBe(true);
    expect(matchesRatio('about 2.7 times as much', 2.6957)).toBe(true);
    expect(matchesRatio('about 2.7× as much', 2.6957)).toBe(true);
    expect(matchesRatio('about 2.8 times as much', 2.6957)).toBe(false);
    expect(matchesRatio('$2.7', 2.6957)).toBe(false);
    expect(matchesRatio('2.7k', 2.6957)).toBe(false);
    expect(matchesRatio('nothing', 2.6957)).toBe(false);
    expect(matchesRatio('101', 100)).toBe(true);
    expect(matchesRatio('102', 100)).toBe(false);
    expect(matchesCount('3x as much', 3)).toBe(false);
  });

  it('statesPrice finds an amount in dollars or USD, or a number per million', () => {
    for (const text of [
      '$5',
      '5 USD',
      '0.5 dollars',
      '3 per million tokens',
      '3 PER MILLION TOKENS',
      '3 USD per 1M',
      '2.5 per 1 million',
    ]) {
      expect(statesPrice(text), text).toBe(true);
    }
    for (const text of [
      'no price',
      'it has 3 million tokens',
      'version 5',
      '5x',
    ]) {
      expect(statesPrice(text), text).toBe(false);
    }
  });

  it('matchesRatio never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.double(), (text, value) => {
        expect(typeof matchesRatio(text, value)).toBe('boolean');
        expect(typeof statesPrice(text)).toBe('boolean');
      }),
    );
  });
});

describe('the workload checks, for any output and any case', () => {
  it('never throw but for a case that cannot be read, and return a verdict', () => {
    withSnapshot();
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [
          withinBudget,
          modelsRead,
          workloadCost,
          noPriceStated,
          saysNoFixedPrice,
          saysFree,
        ]) {
          try {
            const result = check(output, context as never);
            expect(typeof result.pass).toBe('boolean');
            expect(result.score).toBe(result.pass ? 1 : 0);
            expect(result.reason).not.toBe('');
          } catch (error) {
            expect(String(error)).toMatch(
              /case|oracle|query|snapshot|EVAL_CATALOG|workload/i,
            );
          }
        }
      }),
    );
  });
});
