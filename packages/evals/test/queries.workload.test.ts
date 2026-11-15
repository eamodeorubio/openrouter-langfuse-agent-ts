import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QUERY_NAMES, QueryError, runQuery } from '../src/oracle/queries.js';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { parseWorkload, workloadCost } from '../src/oracle/workload.js';
import { catalogModel } from './oracleFixture.js';

const CHATBOT = {
  chatsPerDay: 2000,
  inputTokens: 1500,
  outputTokens: 400,
  days: 30,
};

describe('the cost of a workload', () => {
  it('is the tokens of the month times the price per million, input and output', () => {
    expect(workloadCost(CHATBOT, 1, 4)).toBe(186);
    expect(workloadCost(CHATBOT, 2, 5)).toBe(300);
    expect(workloadCost(CHATBOT, 0, 0)).toBe(0);
    expect(
      workloadCost(
        {
          chatsPerDay: 1,
          inputTokens: 5_000_000,
          outputTokens: 5_000_000,
          days: 30,
        },
        30,
        180,
      ),
    ).toBe(31500);
  });

  it('grows with every part of the workload and with each price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 31 }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (chatsPerDay, inputTokens, outputTokens, days, input, output) => {
          const base = workloadCost(
            { chatsPerDay, inputTokens, outputTokens, days },
            input,
            output,
          );
          expect(
            workloadCost(
              { chatsPerDay: chatsPerDay + 1, inputTokens, outputTokens, days },
              input,
              output,
            ),
          ).toBeGreaterThanOrEqual(base);
          expect(
            workloadCost(
              { chatsPerDay, inputTokens, outputTokens, days },
              input + 1,
              output,
            ),
          ).toBeGreaterThan(base);
          expect(base).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('reading a workload', () => {
  it('takes the four counts, each a number from 0, and nothing else', () => {
    expect(parseWorkload(CHATBOT)).toEqual(CHATBOT);
    expect(parseWorkload({ ...CHATBOT, days: 0 })).toEqual({
      ...CHATBOT,
      days: 0,
    });
  });

  it.each([
    ['text', 'big'],
    ['null', null],
    ['a list', []],
    ['a missing count', { chatsPerDay: 1, inputTokens: 1, outputTokens: 1 }],
    ['a count that is text', { ...CHATBOT, days: '30' }],
    ['a count below 0', { ...CHATBOT, inputTokens: -1 }],
    [
      'a count that is not finite',
      { ...CHATBOT, outputTokens: Number.POSITIVE_INFINITY },
    ],
    ['a count that is not known', { ...CHATBOT, hours: 3 }],
  ])('is nothing for %s', (_, value) => {
    expect(parseWorkload(value)).toBeUndefined();
  });
});

const priced = (
  id: string,
  tools: boolean,
  input: number | null,
  output: number | null,
) => catalogModel(id, 100_000, tools, input, output);

const MODELS: CatalogModel[] = [
  priced('w/cheap', true, 1, 4),
  priced('w/dear', true, 2, 8),
  priced('w/blind', false, 1, 4),
  priced('w/none', true, null, null),
  priced('w/free', true, 0, 0),
  priced('w/edge', true, 2, 5),
  priced('w/over', true, 2, 5.0001),
  priced('w/half', true, 1, null),
];

const PARAMS = {
  workload: CHATBOT,
  budget: 300,
  supportedParameters: ['tools'],
};

describe('the query within-budget', () => {
  const run = (params: Record<string, unknown>, models = MODELS) =>
    runQuery('within-budget', models, params);

  it('returns every model with known prices and the parameters whose monthly cost is within the budget', () => {
    expect(run(PARAMS)).toEqual(['w/cheap', 'w/edge', 'w/free']);
  });

  it('takes the budget as inclusive, to the last cent of the model that costs exactly that', () => {
    expect(run(PARAMS)).toContain('w/edge');
    expect(run(PARAMS)).not.toContain('w/over');
    expect(run({ ...PARAMS, budget: 186 })).toEqual(['w/cheap', 'w/free']);
    expect(run({ ...PARAMS, budget: 185.99 })).toEqual(['w/free']);
  });

  it('leaves out a model with no price, or with one price missing, and keeps free models', () => {
    expect(run({ ...PARAMS, budget: 1_000_000 })).not.toContain('w/none');
    expect(run({ ...PARAMS, budget: 1_000_000 })).not.toContain('w/half');
    expect(run({ ...PARAMS, budget: 0 })).toEqual(['w/free']);
  });

  it('asks for the parameters only when it is given some', () => {
    expect(run({ workload: CHATBOT, budget: 300 })).toContain('w/blind');
    expect(run(PARAMS)).not.toContain('w/blind');
    expect(
      run({ ...PARAMS, supportedParameters: ['tools', 'reasoning'] }),
    ).toEqual([]);
  });

  it('is in ascending order of slug, whatever the order of the snapshot', () => {
    expect(run(PARAMS, [...MODELS].reverse())).toEqual([
      'w/cheap',
      'w/edge',
      'w/free',
    ]);
  });

  it.each([
    [
      { budget: 300 },
      'The query within-budget takes workload as an object of chatsPerDay, inputTokens, outputTokens and days, each a number from 0, got undefined.',
    ],
    [
      { workload: { ...CHATBOT, days: -1 }, budget: 300 },
      'The query within-budget takes workload as an object of chatsPerDay, inputTokens, outputTokens and days, each a number from 0, got {"chatsPerDay":2000,"inputTokens":1500,"outputTokens":400,"days":-1}.',
    ],
    [
      { workload: CHATBOT },
      'The query within-budget takes budget as a number from 0, got undefined.',
    ],
    [
      { workload: CHATBOT, budget: -5 },
      'The query within-budget takes budget as a number from 0, got -5.',
    ],
    [
      { workload: CHATBOT, budget: 'cheap' },
      'The query within-budget takes budget as a number from 0, got "cheap".',
    ],
    [
      { workload: CHATBOT, budget: 1, supportedParameters: 'tools' },
      'The query within-budget takes supportedParameters as a list of text, got "tools".',
    ],
    [
      { workload: CHATBOT, budget: 1, mix: 3 },
      'Unknown parameter "mix" for the query within-budget. The known ones are: workload, budget, supportedParameters.',
    ],
  ])('refuses the parameters %j', (params, message) => {
    expect(() => run(params)).toThrow(QueryError);
    expect(() => run(params)).toThrow(message);
  });

  it('is one of the named queries', () => {
    expect(QUERY_NAMES).toEqual([
      'cheapest-blended',
      'cheapest-input',
      'matching',
      'within-budget',
    ]);
  });
});

describe('the query within-budget, for any snapshot', () => {
  const price = fc.option(fc.double({ min: 0, max: 50, noNaN: true }), {
    nil: null,
  });
  const snapshot = fc
    .uniqueArray(fc.stringMatching(/^[a-z]{1,3}\/[a-z0-9]{1,4}$/), {
      maxLength: 10,
    })
    .chain((ids) =>
      fc.tuple(
        ...ids.map((id) =>
          fc.record({
            id: fc.constant(id),
            contextLength: fc.constant(1000),
            supportedParameters: fc.subarray(['tools', 'seed']),
            inputModalities: fc.constant<string[]>(['text']),
            outputModalities: fc.constant<string[]>(['text']),
            inputPrice: price,
            outputPrice: price,
          }),
        ),
      ),
    ) as fc.Arbitrary<CatalogModel[]>;
  const workload = fc.record({
    chatsPerDay: fc.integer({ min: 0, max: 5000 }),
    inputTokens: fc.integer({ min: 0, max: 5000 }),
    outputTokens: fc.integer({ min: 0, max: 5000 }),
    days: fc.integer({ min: 0, max: 31 }),
  });

  it('returns only models that cost at most the budget, with known prices', () => {
    fc.assert(
      fc.property(
        snapshot,
        workload,
        fc.integer({ min: 0, max: 100_000 }),
        (models, load, budget) => {
          for (const id of runQuery('within-budget', models, {
            workload: load,
            budget,
          })) {
            const found = models.find((m) => m.id === id) as CatalogModel;
            expect(found.inputPrice).not.toBeNull();
            expect(found.outputPrice).not.toBeNull();
            expect(
              workloadCost(
                load,
                found.inputPrice as number,
                found.outputPrice as number,
              ),
            ).toBeLessThanOrEqual(budget);
          }
        },
      ),
    );
  });

  it('never loses a model when the budget rises', () => {
    fc.assert(
      fc.property(
        snapshot,
        workload,
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        (models, load, budget, more) => {
          const small = runQuery('within-budget', models, {
            workload: load,
            budget,
          });
          const large = runQuery('within-budget', models, {
            workload: load,
            budget: budget + more,
          });
          for (const id of small) expect(large).toContain(id);
        },
      ),
    );
  });

  it('does not depend on the order of the snapshot', () => {
    fc.assert(
      fc.property(
        snapshot,
        workload,
        fc.integer({ min: 0, max: 100_000 }),
        (models, load, budget) => {
          expect(
            runQuery('within-budget', [...models].reverse(), {
              workload: load,
              budget,
            }),
          ).toEqual(
            runQuery('within-budget', models, { workload: load, budget }),
          );
        },
      ),
    );
  });
});
