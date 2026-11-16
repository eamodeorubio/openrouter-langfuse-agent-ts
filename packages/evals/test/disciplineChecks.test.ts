import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  noPriceForUnknown,
  recovered,
  serialLookups,
} from '../src/checks/assertions.js';
import { CaseError } from '../src/checks/caseSpec.js';
import { catalogModel, snapshotFile } from './oracleFixture.js';

interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const read = (id: string, round: number, failed = false): Call => ({
  round,
  name: 'get_model',
  arguments: JSON.stringify({ slug: id }),
  output: failed
    ? JSON.stringify({ error: 'not found' })
    : JSON.stringify({
        id,
        context_length: 1000,
        pricing: { prompt: 1, completion: 4 },
      }),
  failed,
});

const search = (round: number, ids: string[]): Call => ({
  round,
  name: 'search_models',
  arguments: '{}',
  output: JSON.stringify({
    total: ids.length,
    models: ids.map((id) => ({
      id,
      context_length: 1000,
      prompt_price: 1,
      completion_price: 4,
    })),
  }),
  failed: false,
});

const success = (answer: string, toolCalls: Call[], question = 'q') => ({
  question,
  answer,
  success: true,
  toolCalls,
});
const meta = (metadata: Record<string, unknown>) => ({ test: { metadata } });

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = () =>
  vi.stubEnv(
    'EVAL_CATALOG',
    snapshotFile([
      catalogModel('a/b', 100_000, true, 1, 4),
      catalogModel('c/d', 100_000, true, 2, 8),
      catalogModel('e/f', 100_000, true, 0.5, 1),
    ]),
  );

describe('serialLookups, for serial-lookups', () => {
  const parallel = meta({ parallelLookups: true });
  const ask = 'Compare the prices of a/b and c/d.';

  it('passes when every model of the question was read in one round', () => {
    withSnapshot();
    const result = serialLookups(
      success('x', [read('a/b', 1), read('c/d', 1)], ask),
      parallel,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('Every model was read in round 1.');
  });

  it('fails when the models were read in separate rounds, and says which', () => {
    withSnapshot();
    const result = serialLookups(
      success('x', [read('a/b', 1), read('c/d', 2)], ask),
      parallel,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The models were read in separate rounds: a/b in round 1, c/d in round 2.',
    );
  });

  it('judges the earliest successful call of a model, and counts no failed call', () => {
    withSnapshot();
    expect(
      serialLookups(
        success('x', [read('a/b', 1), read('c/d', 1), read('c/d', 2)], ask),
        parallel,
      ).pass,
    ).toBe(true);
    expect(
      serialLookups(
        success(
          'x',
          [read('a/b', 1), read('c/d', 1, true), read('c/d', 2)],
          ask,
        ),
        parallel,
      ).pass,
    ).toBe(false);
  });

  it('leaves a model that no call read to wrong-search', () => {
    withSnapshot();
    expect(
      serialLookups(success('x', [read('a/b', 1)], ask), parallel).reason,
    ).toBe('Left to wrong-search.');
  });

  it('asks nothing of a run that read fewer than two models with get_model', () => {
    withSnapshot();
    const found = serialLookups(
      success('x', [read('a/b', 1), search(2, ['c/d'])], ask),
      parallel,
    );
    expect(found.pass).toBe(true);
    expect(found.reason).toBe(
      'Fewer than two models were read with get_model.',
    );
  });

  it('reads the slug of a get_model call, and counts no call that has none or is of another tool', () => {
    withSnapshot();
    for (const args of ['garbage', '[]', '{"slug":3}', 'null']) {
      const odd = { ...read('a/b', 1), arguments: args };
      expect(
        serialLookups(success('x', [odd, read('c/d', 1)], ask), parallel)
          .reason,
        args,
      ).toBe('Fewer than two models were read with get_model.');
    }
    const searched = {
      ...read('c/d', 5),
      name: 'search_models',
    };
    expect(
      serialLookups(
        success('x', [read('a/b', 1), read('c/d', 2), searched], ask),
        parallel,
      ).pass,
    ).toBe(false);
    expect(
      serialLookups(
        success(
          'x',
          [
            read('a/b', 2),
            read('c/d', 3),
            { ...read('a/b', 1), name: 'search_models' },
          ],
          ask,
        ),
        parallel,
      ).pass,
    ).toBe(false);
  });

  it('reads no round from a call that has none', () => {
    withSnapshot();
    const unnumbered = { ...read('a/b', 1), round: undefined as never };
    expect(
      serialLookups(success('x', [unnumbered, read('c/d', 1)], ask), parallel)
        .reason,
    ).toBe('Fewer than two models were read with get_model.');
  });

  it('does not apply to a case that does not declare parallel lookups, or declares none', () => {
    withSnapshot();
    const serial = [read('a/b', 1), read('c/d', 2)];
    expect(serialLookups(success('x', serial, ask), meta({})).reason).toBe(
      'The lookups are not declared independent.',
    );
    expect(
      serialLookups(success('x', serial, ask), meta({ parallelLookups: false }))
        .pass,
    ).toBe(true);
  });

  it('leaves a run with no lookup or no answer to earlier classes, and refuses a question with no model', () => {
    withSnapshot();
    expect(serialLookups(success('x', [], ask), parallel).reason).toBe(
      'Left to an earlier class.',
    );
    expect(() =>
      serialLookups(success('x', [read('a/b', 1)], 'No model.'), parallel),
    ).toThrow(CaseError);
  });

  it('gives the same verdict for any order of the calls', () => {
    withSnapshot();
    const calls = [read('a/b', 1), read('c/d', 2), read('a/b', 3)];
    fc.assert(
      fc.property(fc.shuffledSubarray(calls, { minLength: 2 }), (subset) => {
        const forward = serialLookups(success('x', subset, ask), parallel);
        const backward = serialLookups(
          success('x', [...subset].reverse(), ask),
          parallel,
        );
        expect(backward.pass).toBe(forward.pass);
      }),
    );
  });
});

describe('recovered, for no-recovery', () => {
  const typo = meta({
    recovery: { misspelled: 'a/bb', correction: 'a/b' },
  });
  const ask = 'What does a/bb cost per million tokens?';
  const lost = read('a/bb', 1, true);

  it('passes a run that read the correction in a later round than the failed lookup', () => {
    const result = recovered(
      success('x', [lost, search(2, ['a/b']), read('a/b', 3)], ask),
      typo,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('a/b was read after the failed lookup of a/bb.');
  });

  it('fails a run that gave up, and says what it lacked', () => {
    const result = recovered(
      success('Sorry, a/bb does not exist.', [lost], ask),
      typo,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('No successful get_model call read a/b.');
  });

  it('fails a run that found the correction only with a search', () => {
    expect(
      recovered(success('x', [lost, search(2, ['a/b'])], ask), typo).pass,
    ).toBe(false);
  });

  it('fails a run that read the correction before the failed lookup', () => {
    const result = recovered(
      success('x', [read('a/b', 1), read('a/bb', 2, true)], ask),
      typo,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'a/b was not read after the failed lookup of a/bb.',
    );
  });

  it.each([
    ['the misspelling first', [read('a/bb', 1, true), read('a/b', 1)]],
    ['the correction first', [read('a/b', 1), read('a/bb', 1, true)]],
  ])('passes a run that sent both lookups in one round, %s', (_, calls) => {
    const result = recovered(success('x', calls, ask), typo);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('a/b was read after the failed lookup of a/bb.');
  });

  it('passes exactly when the latest read of the correction is not before the earliest failed lookup', () => {
    const round = fc.integer({ min: 1, max: 6 });
    fc.assert(
      fc.property(
        fc.array(round, { minLength: 1, maxLength: 4 }),
        fc.array(round, { minLength: 1, maxLength: 4 }),
        (reads, lostRounds) => {
          const calls = [
            ...lostRounds.map((r) => read('a/bb', r, true)),
            ...reads.map((r) => read('a/b', r)),
          ];
          const result = recovered(success('x', calls, ask), typo);
          expect(result.pass).toBe(
            Math.max(...reads) >= Math.min(...lostRounds),
          );
        },
      ),
    );
  });

  it('passes a run that read the correction with no failed lookup of the misspelling', () => {
    const result = recovered(success('x', [read('a/b', 1)], ask), typo);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('a/b was read, with no failed lookup of a/bb.');
  });

  it('does not take a search for a read of the correction, or a successful lookup for a failed one', () => {
    const searched = { ...read('a/b', 2), name: 'search_models' };
    expect(recovered(success('x', [lost, searched], ask), typo).pass).toBe(
      false,
    );
    expect(
      recovered(success('x', [read('a/bb', 1), read('a/b', 1)], ask), typo)
        .reason,
    ).toBe('a/b was read, with no failed lookup of a/bb.');
  });

  it('compares the slugs in any case, and counts only a failed lookup of the misspelling', () => {
    const upper = meta({
      recovery: { misspelled: 'A/BB', correction: 'A/B' },
    });
    expect(
      recovered(success('x', [lost, read('a/b', 2)], ask), upper).pass,
    ).toBe(true);
    expect(
      recovered(success('x', [read('c/d', 1, true), read('a/b', 2)], ask), typo)
        .reason,
    ).toBe('a/b was read, with no failed lookup of a/bb.');
  });

  it('judges the earliest failed lookup and the latest read of the correction', () => {
    expect(
      recovered(
        success(
          'x',
          [read('a/bb', 2, true), read('a/b', 1), read('a/b', 3)],
          ask,
        ),
        typo,
      ).pass,
    ).toBe(true);
    expect(
      recovered(
        success(
          'x',
          [read('a/bb', 1, true), read('a/bb', 3, true), read('a/b', 2)],
          ask,
        ),
        typo,
      ).pass,
    ).toBe(true);
  });

  it('does not apply to a case with no recovery, and leaves a blank answer to an earlier class', () => {
    expect(recovered(success('x', [lost], ask), meta({})).reason).toBe(
      'No recovery declared.',
    );
    expect(recovered(success('  ', [lost], ask), typo).reason).toBe(
      'Left to an earlier class.',
    );
    expect(recovered('not a run', typo).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('noPriceForUnknown, for invented-data', () => {
  const unknown = meta({ unknownModel: 'x/gone' });
  const ask = 'What does x/gone cost per million tokens?';
  const lost = read('x/gone', 1, true);

  it.each([
    'It costs $2 per million tokens.',
    'About 2 USD.',
    'Roughly 3 per million.',
  ])('fails an answer that states a price: %s', (answer) => {
    withSnapshot();
    const result = noPriceForUnknown(success(answer, [lost], ask), unknown);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer states a price for x/gone, which the snapshot lacks.',
    );
  });

  it('passes an answer that says the model was not found and prices other models', () => {
    withSnapshot();
    const answer =
      'I could not find x/gone, so I have no price for it.\n\nThe newest models are:\n- `y/new`: $1 / $5\n- `y/newer`: $2 / $10 per million tokens';
    const result = noPriceForUnknown(success(answer, [lost], ask), unknown);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The answer states no price for x/gone.');
  });

  it.each([
    'x/gone costs $2, less than `y/new` at $1.',
    '| x/gone | $2 per million |',
    '- `x/gone` is priced at 3 USD.\n- `y/new`: $1',
    'x/gone is not on the list. Still, x/gone costs about $2.',
  ])('fails a price that follows the slug: %s', (answer) => {
    withSnapshot();
    expect(noPriceForUnknown(success(answer, [lost], ask), unknown).pass).toBe(
      false,
    );
  });

  it.each([
    'x/gone is not on the list. `y/new` costs $1.',
    'x/gone is not on the list; `y/new` costs $1.',
    'Not found: x/gone, and so `y/new` at $1 is the nearest.',
    '$2 per million is what `y/new` costs, and x/gone is unknown.',
  ])("does not take another model's price for its price: %s", (answer) => {
    withSnapshot();
    expect(noPriceForUnknown(success(answer, [lost], ask), unknown).pass).toBe(
      true,
    );
  });

  it('reads an answer that never names the model sentence by sentence', () => {
    withSnapshot();
    const check = (answer: string) =>
      noPriceForUnknown(success(answer, [lost], ask), unknown).pass;
    expect(check('It costs $2 per million tokens.')).toBe(false);
    expect(check('I found nothing. It costs about 2 USD.')).toBe(false);
    expect(
      check('I found nothing. The newest is `y/new`: $1 per million.'),
    ).toBe(true);
  });

  it.each([
    'I could not find x/gone. It would cost about $2 per million tokens.',
    'x/gone is not on the list.\n\nIt would cost about 2 USD.',
    'x/gone costs, e.g. $2 per million tokens.',
    'x/gone costs approx. $2 per million tokens.',
    'x/gone costs i.e. $2, vs. $1 for the other.',
  ])(
    'fails a price in a later sentence, or after an abbreviation: %s',
    (answer) => {
      withSnapshot();
      expect(
        noPriceForUnknown(success(answer, [lost], ask), unknown).pass,
      ).toBe(false);
    },
  );

  it('does not take a longer slug that ends in the unknown one for a mention of it', () => {
    withSnapshot();
    expect(
      noPriceForUnknown(
        success(
          'ax/gone costs $2. foo-x/gone costs $3. x/gone is not found.',
          [lost],
          ask,
        ),
        unknown,
      ).pass,
    ).toBe(true);
  });

  it('passes whatever another model costs, when that model is named before its price', () => {
    withSnapshot();
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ,]*$/),
        fc.integer({ min: 0, max: 1000 }),
        (filler, amount) => {
          const answer = `x/gone is gone${filler}. \`y/new\` costs $${amount} per million.`;
          expect(
            noPriceForUnknown(success(answer, [lost], ask), unknown).pass,
          ).toBe(true);
        },
      ),
    );
  });

  it('takes the slug for the text it is, not for a pattern', () => {
    withSnapshot();
    const dotted = meta({ unknownModel: 'x/g.ne' });
    expect(
      noPriceForUnknown(success('x/gone costs $2.', [lost], ask), dotted).pass,
    ).toBe(true);
    expect(
      noPriceForUnknown(success('x/g.ne costs $2.', [lost], ask), dotted).pass,
    ).toBe(false);
  });

  it.each([
    ['of the snapshot', 'x/gone is unknown; a/b costs $1.'],
    ['of the unknown model', 'x/gone is unknown; x/other costs $1.'],
  ])('stops at an unquoted model by an author %s', (_, answer) => {
    withSnapshot();
    expect(noPriceForUnknown(success(answer, [lost], ask), unknown).pass).toBe(
      true,
    );
  });

  it('does not stop at a token that is no model, such as input/output', () => {
    withSnapshot();
    expect(
      noPriceForUnknown(
        success('x/gone has an input/output price of $2.', [lost], ask),
        unknown,
      ).pass,
    ).toBe(false);
  });

  it('never fails an answer that holds no price', () => {
    withSnapshot();
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z .,;:\n-]*$/),
        fc.stringMatching(/^[a-z .,;:\n-]*$/),
        (before, after) => {
          const answer = `${before} x/gone ${after}`;
          expect(
            noPriceForUnknown(success(answer, [lost], ask), unknown).pass,
          ).toBe(true);
        },
      ),
    );
  });

  it('passes an answer that says the model was not found', () => {
    withSnapshot();
    const result = noPriceForUnknown(
      success('I could not find x/gone.', [lost], ask),
      unknown,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The answer states no price for x/gone.');
  });

  it('judges a run that made no successful call, since it gave an answer', () => {
    withSnapshot();
    expect(
      noPriceForUnknown(success('It costs $2.', [], ask), unknown).pass,
    ).toBe(false);
  });

  it('refuses a model that the snapshot holds, which would make the case a pass for the wrong reason', () => {
    withSnapshot();
    const held = meta({ unknownModel: 'A/B' });
    expect(() => noPriceForUnknown(success('x', [lost], ask), held)).toThrow(
      CaseError,
    );
    expect(() => noPriceForUnknown(success('x', [lost], ask), held)).toThrow(
      'The snapshot holds A/B, so the case cannot ask about a model that it lacks.',
    );
  });

  it('does not apply to a case with no unknown model, and leaves a blank answer to an earlier class', () => {
    withSnapshot();
    expect(noPriceForUnknown(success('$2', [lost], ask), meta({})).reason).toBe(
      'No unknown model declared.',
    );
    expect(noPriceForUnknown(success('', [lost], ask), unknown).reason).toBe(
      'Left to an earlier class.',
    );
  });
});

describe('the discipline checks, for any output and any case', () => {
  it('never throw but for a case that cannot be read, and return a verdict', () => {
    withSnapshot();
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (output, context) => {
        for (const check of [serialLookups, recovered, noPriceForUnknown]) {
          try {
            const result = check(output, context as never);
            expect(typeof result.pass).toBe('boolean');
            expect(result.score).toBe(result.pass ? 1 : 0);
            expect(result.reason).not.toBe('');
          } catch (error) {
            expect(String(error)).toMatch(
              /case|declaration|snapshot|EVAL_CATALOG/i,
            );
          }
        }
      }),
    );
  });
});
