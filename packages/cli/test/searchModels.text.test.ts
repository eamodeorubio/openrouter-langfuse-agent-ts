import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { createCatalogCache } from '../src/tools/catalogCache.js';
import { callTool, functionTools, TOOLS } from '../src/tools/registry.js';
import { searchModels } from '../src/tools/searchModels.js';
import { recordedModelsList } from './fixtures.js';

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

const HOST = 'https://openrouter.ai';
const client = createClient('sk-test-key');
const parse = (args: unknown) => searchModels.parameters.safeParse(args);

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

/** The numeric arguments: a valid value, and one the argument refuses. */
const NUMBERS: [name: string, valid: number, invalid: number][] = [
  ['input_per_output', 3, 0],
  ['min_context_length', 1000, 0],
  ['min_prompt_price', 0.5, -1],
  ['max_prompt_price', 2, -1],
  ['min_completion_price', 1, -1],
  ['max_completion_price', 10, -1],
  ['min_intelligence_index', 40, -1],
  ['min_coding_index', 30, -1],
  ['min_agentic_index', 20, -1],
  ['min_tool_success_rate', 0.9, 1.5],
  ['max_age_days', 30, -1],
  ['limit', 5, 51],
  ['offset', 20, -1],
];

// A blended sort lets input_per_output stand beside the other arguments.
const BASE = { sort: 'blended-price-low-to-high' };

const messageOf = async (args: Record<string, unknown>) => {
  const result = await callTool(TOOLS, 'search_models', JSON.stringify(args), {
    client,
    timeoutMs: 60_000,
  });
  return result.ok ? undefined : result.message;
};

describe('search_models numbers sent as text', () => {
  it.each(NUMBERS)('reads %s "text" as the number', (name, valid) => {
    const parsed = parse({ ...BASE, [name]: String(valid) });
    expect(parsed.success && (parsed.data as never)[name]).toBe(valid);
  });

  it.each(NUMBERS)(
    'refuses %s with a value out of range, as a number and as text',
    (name, _valid, invalid) => {
      expect(parse({ ...BASE, [name]: invalid }).success).toBe(false);
      expect(parse({ ...BASE, [name]: String(invalid) }).success).toBe(false);
    },
  );

  it.each(NUMBERS)(
    'tells the model what %s was given and what to send',
    async (name, _valid, invalid) => {
      const given = await messageOf({ ...BASE, [name]: String(invalid) });
      expect(given).toMatch(
        new RegExp(
          `^Invalid arguments\\. ${name}: must be .+; got "${invalid}"\\.`,
        ),
      );
      const word = await messageOf({ ...BASE, [name]: 'abc' });
      expect(word).toMatch(
        new RegExp(`^Invalid arguments\\. ${name}: must be .+; got "abc"\\.`),
      );
    },
  );

  it.each([' 3 ', '+3', '3.', '.5', '1e3', '1E-2', '0003'])(
    'accepts the text %j',
    (text) => {
      expect(parse({ min_prompt_price: text }).success).toBe(true);
    },
  );

  it.each([
    '',
    ' ',
    'abc',
    '0x10',
    'Infinity',
    'NaN',
    '1,000',
    '1_000',
    '3 tokens',
    '--3',
    '1e',
    'true',
    '1e999',
    '-1e999',
  ])('refuses the text %j', (text) => {
    expect(parse({ min_prompt_price: text }).success).toBe(false);
  });

  it.each([
    ['many', 'got "many".'],
    [[1], 'got [1].'],
    [true, 'got true.'],
    [{ a: 1 }, 'got {"a":1}.'],
  ])(
    'tells the model what limit %j was and what to send',
    async (value, got) => {
      expect(await messageOf({ limit: value })).toBe(
        `Invalid arguments. limit: must be a whole number from 1 to 50; ${got}`,
      );
    },
  );

  it.each([
    ['min_context_length', 1],
    ['min_prompt_price', 0],
    ['max_prompt_price', 0],
    ['min_completion_price', 0],
    ['max_completion_price', 0],
    ['min_intelligence_index', 0],
    ['min_coding_index', 0],
    ['min_agentic_index', 0],
    ['min_tool_success_rate', 0],
    ['min_tool_success_rate', 1],
    ['max_age_days', 0],
    ['limit', 1],
    ['limit', 50],
    ['offset', 0],
  ])(
    'takes the bound itself: %s of %s, as a number and as text',
    (name, bound) => {
      expect(parse({ ...BASE, [name]: bound }).success).toBe(true);
      expect(parse({ ...BASE, [name]: String(bound) }).success).toBe(true);
    },
  );

  it.each([
    ['limit', '0'],
    ['limit', '2.5'],
    ['offset', '1.5'],
    ['offset', '-1'],
    ['min_context_length', '1.5'],
    ['max_age_days', '0.5'],
    ['max_age_days', '-1'],
  ])('refuses the text %s: "%s", as the number would', (name, text) => {
    expect(parse({ [name]: text }).success).toBe(false);
    expect(parse({ [name]: Number(text) }).success).toBe(false);
  });

  it('refuses the text of a fraction for every argument that wants a whole number', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 9 }),
        (whole, tenths) => {
          const text = `${whole}.${tenths}`;
          for (const name of [
            'limit',
            'offset',
            'min_context_length',
            'max_age_days',
          ]) {
            expect(parse({ [name]: text }).success, `${name} ${text}`).toBe(
              false,
            );
          }
        },
      ),
    );
  });

  it('reads a number and its text alike, for any number', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (value) => {
          const number = parse({ min_prompt_price: value });
          const text = parse({ min_prompt_price: String(value) });
          expect(text.success).toBe(number.success);
          if (number.success && text.success) {
            // Not `Object.is`: the text of -0 is "0", and the two are one price.
            expect(
              Math.abs(
                (text.data.min_prompt_price ?? 0) -
                  (number.data.min_prompt_price ?? 0),
              ),
            ).toBe(0);
          }
        },
      ),
    );
  });

  it('reads the text of a whole number as that number, in a page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 10_000 }),
        (limit, offset) => {
          const parsed = parse({
            limit: String(limit),
            offset: ` ${offset} `,
          });
          expect(
            parsed.success && [parsed.data.limit, parsed.data.offset],
          ).toEqual([limit, offset]);
        },
      ),
    );
  });

  it('never throws, whatever text or value a number argument gets', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.string(), (value, text) => {
        for (const [name] of NUMBERS) {
          expect(() => parse({ [name]: value })).not.toThrow();
          expect(() => parse({ [name]: text })).not.toThrow();
        }
      }),
    );
  });

  it('still reads null as absent', () => {
    expect(parse({ limit: null, min_prompt_price: null }).data).toEqual({
      limit: 10,
      offset: 0,
    });
  });

  it('sends the numbers, not the text, and no zdr for "false", in one call', async () => {
    let seen: Record<string, string> = {};
    nock(HOST)
      .get('/api/v1/models')
      .query((query) => {
        seen = query as Record<string, string>;
        return true;
      })
      .reply(200, recordedModelsList);
    const result = await callTool(
      TOOLS,
      'search_models',
      JSON.stringify({
        min_context_length: ' 200000 ',
        limit: '5',
        zero_data_retention: 'false',
      }),
      { client, timeoutMs: 60_000, catalog: createCatalogCache() },
    );
    expect(result.ok).toBe(true);
    expect(seen).toMatchObject({ context: '200000', limit: '5' });
    expect(seen).not.toHaveProperty('zdr');
  });
});

describe('search_models booleans sent as text', () => {
  const PRICED = { sort: 'input-price-low-to-high' };

  it.each([
    ['paid_only', true, PRICED],
    ['paid_only', false, PRICED],
    ['zero_data_retention', true, {}],
    ['zero_data_retention', false, {}],
  ])(
    'reads %s %j, as a boolean and as text, as that boolean',
    (name, value, rest) => {
      for (const sent of [value, String(value)]) {
        const parsed = parse({ ...rest, [name]: sent });
        expect(
          parsed.success && (parsed.data as never)[name],
          String(sent),
        ).toBe(value);
      }
    },
  );

  it.each(['paid_only', 'zero_data_retention'])(
    'tells the model what %s was given and what to send',
    async (name) => {
      for (const given of ['yes', 'True', '1', '']) {
        expect(await messageOf({ ...PRICED, [name]: given })).toBe(
          `Invalid arguments. ${name}: must be true or false, sent as a boolean or as the text "true" or "false"; got ${JSON.stringify(given)}.`,
        );
      }
      expect(await messageOf({ ...PRICED, [name]: 1 })).toBe(
        `Invalid arguments. ${name}: must be true or false, sent as a boolean or as the text "true" or "false"; got 1.`,
      );
    },
  );
});

describe('search_models schema for text values', () => {
  interface Node {
    type?: string | string[];
    anyOf?: Node[];
    description?: string;
  }
  const [tool] = functionTools([searchModels]) as unknown as {
    function: { parameters: { properties: Record<string, Node> } };
  }[];
  const properties = tool?.function.parameters.properties ?? {};

  /** Every JSON type the schema of an argument offers, nested unions included. */
  const typesOf = (node: Node | undefined): string[] => [
    ...[node?.type ?? []].flat(),
    ...(node?.anyOf ?? []).flatMap(typesOf),
  ];

  it.each(NUMBERS)('offers %s as a number or text', (name) => {
    expect(typesOf(properties[name])).toEqual(
      expect.arrayContaining(['number', 'string']),
    );
  });

  it.each(NUMBERS)('says in the description of %s that text works', (name) => {
    expect(properties[name]?.description).toMatch(
      /numeric text such as "\d+(?:\.\d+)?"/,
    );
  });

  it.each(['paid_only', 'zero_data_retention'])(
    'offers %s as a boolean or text, and says so',
    (name) => {
      expect(typesOf(properties[name])).toEqual(
        expect.arrayContaining(['boolean', 'string']),
      );
      expect(properties[name]?.description).toMatch(/"true" or "false"/);
    },
  );
});
