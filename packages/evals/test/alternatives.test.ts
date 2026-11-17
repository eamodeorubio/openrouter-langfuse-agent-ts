import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { alternativesPresented } from '../src/checks/assertions.js';
import { CaseError, readCase } from '../src/checks/caseSpec.js';
import { catalogModel as model, snapshotFile } from './oracleFixture.js';

interface Call {
  round: number;
  name: string;
  arguments: string;
  output: string;
  failed: boolean;
}

const WIDE = { min_context_length: 200000, supported_parameters: ['tools'] };

const search = (args: Record<string, unknown> = WIDE): Call => ({
  round: 1,
  name: 'search_models',
  arguments: JSON.stringify(args),
  output: JSON.stringify({ total: 1, models: [{ id: 'f/a' }] }),
  failed: false,
});

const answer = (text: string, toolCalls: Call[] = [search()]) => ({
  question: 'q',
  answer: text,
  success: true,
  toolCalls,
});

const PARAMS = { minContext: 200000, supportedParameters: ['tools'] };
const GROUPS = [
  { name: 'free', query: 'free', params: PARAMS },
  { name: 'blend', query: 'cheapest-blended', params: PARAMS },
  { name: 'input', query: 'cheapest-input', params: PARAMS },
];
const alternatives = (min = 2, groups: unknown[] = GROUPS) => ({
  test: { metadata: { alternatives: { min, groups }, search: WIDE } },
});

/** Free: f/a, f/b. Cheapest by blend: p/blend. Cheapest by input: p/input. */
const CATALOG = [
  model('f/a', 300000, true, 0, 0),
  model('f/b', 300000, true, 0, 0),
  model('p/blend', 300000, true, 1.0, 2.0),
  model('p/input', 300000, true, 0.5, 20),
  model('p/other', 300000, true, 5, 5),
];
const NO_FREE = CATALOG.filter((entry) => !entry.id.startsWith('f/'));

afterEach(() => vi.unstubAllEnvs());
const withSnapshot = (models = CATALOG) =>
  vi.stubEnv('EVAL_CATALOG', snapshotFile(models));

describe('alternativesPresented, for missing-alternative', () => {
  it('passes an answer that names a free model and the cheapest paid one', () => {
    withSnapshot();
    const result = alternativesPresented(
      answer('Free: `f/a`. Paid: `p/blend`.'),
      alternatives(),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(
      'The answer names acceptable models from 2 of the 3 groups.',
    );
  });

  it('passes two paid alternatives that differ by price, since the case asks for two groups, not for a free model', () => {
    withSnapshot();
    expect(
      alternativesPresented(
        answer('By blend `p/blend`, by input `p/input`.'),
        alternatives(),
      ).pass,
    ).toBe(true);
  });

  it('fails an answer that stays within one group, and names the groups it missed', () => {
    withSnapshot();
    const result = alternativesPresented(
      answer('The cheapest are `f/a` and `f/b`.'),
      alternatives(),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toBe(
      'The answer names acceptable models from 1 of the 2 groups the case needs. Missed: blend (p/blend); input (p/input).',
    );
  });

  it('does not count a model that no group accepts', () => {
    withSnapshot();
    expect(
      alternativesPresented(answer('Take `p/other` or `f/a`.'), alternatives())
        .pass,
    ).toBe(false);
  });

  it('leaves out a group whose query returns nothing, and lowers the minimum to the groups left', () => {
    withSnapshot(NO_FREE);
    expect(
      alternativesPresented(answer('`p/blend` and `p/input`.'), alternatives(3))
        .pass,
    ).toBe(true);
    expect(
      alternativesPresented(answer('Only `p/blend`.'), alternatives(3)).pass,
    ).toBe(false);
  });

  it('needs 2 of the 2 groups left when one of three is empty, as the spec says', () => {
    withSnapshot(NO_FREE);
    expect(
      alternativesPresented(answer('`p/blend` and `p/input`.'), alternatives())
        .pass,
    ).toBe(true);
    expect(
      alternativesPresented(answer('Only `p/blend`.'), alternatives()).pass,
    ).toBe(false);
  });

  it('passes when no group has an acceptable model, since nothing could be named', () => {
    withSnapshot([model('x/y', 1000, false, 1, 1)]);
    const result = alternativesPresented(answer('nothing'), alternatives());
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('The snapshot holds no acceptable model.');
  });

  it('leaves a run whose searches dropped the declared filters to wrong-search', () => {
    withSnapshot();
    const result = alternativesPresented(
      answer('Only `f/a`.', [search({ supported_parameters: ['tools'] })]),
      alternatives(),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('Left to wrong-search.');
  });

  it('leaves a run with no successful lookup to an earlier class', () => {
    withSnapshot();
    const result = alternativesPresented(
      answer('Only `f/a`.', []),
      alternatives(),
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('Left to an earlier class.');
  });

  it('passes a case that declares no alternatives', () => {
    withSnapshot();
    const result = alternativesPresented(answer('x'), {
      test: { metadata: {} },
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('No alternatives declared.');
  });

  it('never turns a pass into a fail when the answer names more models', () => {
    withSnapshot();
    const slugs = ['f/a', 'f/b', 'p/blend', 'p/input', 'p/other', 'x/none'];
    const say = (list: string[]) => list.map((s) => `\`${s}\``).join(' ');
    fc.assert(
      fc.property(
        fc.subarray(slugs, { minLength: 1 }),
        fc.subarray(slugs),
        (some, more) => {
          const small = alternativesPresented(
            answer(say(some)),
            alternatives(),
          );
          const large = alternativesPresented(
            answer(say([...some, ...more])),
            alternatives(),
          );
          expect(!small.pass || large.pass).toBe(true);
        },
      ),
    );
  });

  it('never throws, whatever the answer says', () => {
    withSnapshot();
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() =>
          alternativesPresented(answer(text), alternatives()),
        ).not.toThrow();
      }),
    );
  });
});

describe('the alternatives declaration of a case', () => {
  const read = (declared: unknown) =>
    readCase({ test: { metadata: { alternatives: declared } } });

  it('reads a minimum and groups, each a name, a query and its parameters', () => {
    expect(read({ min: 2, groups: GROUPS }).alternatives).toEqual({
      min: 2,
      groups: GROUPS.map(({ name, query, params }) => ({
        name,
        oracle: { query, params },
      })),
    });
  });

  it('takes the parameters of a group as empty when none are given', () => {
    expect(
      read({ min: 1, groups: [{ name: 'any', query: 'free' }] }).alternatives
        ?.groups[0]?.oracle.params,
    ).toEqual({});
  });

  it.each([
    ['no groups', { min: 1, groups: [] }],
    ['groups that are not a list', { min: 1, groups: 'free' }],
    ['a minimum of 0', { min: 0, groups: GROUPS }],
    ['a minimum that is not whole', { min: 1.5, groups: GROUPS }],
    ['no minimum', { groups: GROUPS }],
    ['a group without a name', { min: 1, groups: [{ query: 'free' }] }],
    [
      'two groups with one name',
      {
        min: 1,
        groups: [
          { name: 'a', query: 'free' },
          { name: 'a', query: 'free' },
        ],
      },
    ],
    ['an unknown query', { min: 1, groups: [{ name: 'a', query: 'bogus' }] }],
    [
      'parameters that are not an object',
      { min: 1, groups: [{ name: 'a', query: 'free', params: 3 }] },
    ],
    ['a key it does not know', { min: 1, groups: GROUPS, extra: true }],
    [
      'a group key it does not know',
      { min: 1, groups: [{ name: 'a', query: 'free', extra: 1 }] },
    ],
    ['a declaration that is not an object', 'free'],
  ])('refuses %s, and names the declaration', (_what, declared) => {
    expect(() => read(declared)).toThrow(CaseError);
    expect(() => read(declared)).toThrow(/alternatives/);
  });
});

describe('the case search/alternatives, as the file declares it', () => {
  const file = path.resolve(import.meta.dirname, '../cases/search.yaml');
  const found = (
    parse(fs.readFileSync(file, 'utf8')) as {
      metadata: Record<string, unknown>;
    }[]
  ).find((entry) => entry.metadata.id === 'search/alternatives');
  const declared = { test: { metadata: found?.metadata ?? {} } };

  it('fails an answer made of free models only, and passes one that adds a paid model', () => {
    withSnapshot();
    expect(
      alternativesPresented(answer('Free: `f/a`, `f/b`.'), declared).pass,
    ).toBe(false);
    expect(
      alternativesPresented(answer('Free: `f/a`. Paid: `p/blend`.'), declared)
        .pass,
    ).toBe(true);
  });
});
