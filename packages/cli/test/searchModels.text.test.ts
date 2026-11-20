import fc from 'fast-check';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { INSTRUCTIONS } from '../src/instructions.js';
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

/** What each numeric argument must be, as the spec table words it. */
const PHRASES: Record<string, string> = {
  input_per_output:
    'above 0, the input tokens for each output token, such as 3',
  min_context_length: 'a whole number of tokens, 1 or more',
  min_prompt_price: 'a price in USD per million tokens, 0 or more',
  max_prompt_price: 'a price in USD per million tokens, 0 or more',
  min_completion_price: 'a price in USD per million tokens, 0 or more',
  max_completion_price: 'a price in USD per million tokens, 0 or more',
  min_intelligence_index: 'a score, 0 or more',
  min_coding_index: 'a score, 0 or more',
  min_agentic_index: 'a score, 0 or more',
  min_tool_success_rate: 'a rate from 0 to 1',
  max_age_days: 'a whole number of days, 0 or more',
  limit: 'a whole number from 1 to 50',
  offset: 'a whole number, 0 or more',
};

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
      const phrase = PHRASES[name];
      expect(await messageOf({ ...BASE, [name]: String(invalid) })).toBe(
        `Invalid arguments. ${name}: must be ${phrase}; got "${invalid}".`,
      );
      expect(await messageOf({ ...BASE, [name]: 'abc' })).toBe(
        `Invalid arguments. ${name}: must be ${phrase}; got "abc".`,
      );
      expect(await messageOf({ ...BASE, [name]: [1] })).toBe(
        `Invalid arguments. ${name}: must be ${phrase}; got [1].`,
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
        zero_data_retention: 'False',
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
      for (const given of [
        'yes',
        'Yes',
        '1',
        '0',
        '',
        ' true',
        'true ',
        'truee',
        'falſe',
      ]) {
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

describe('search_models booleans sent as text in any letter case', () => {
  const PRICED = { sort: 'input-price-low-to-high' };
  const BOOLEANS = ['paid_only', 'zero_data_retention'];
  const read = (name: string, sent: unknown) => {
    const parsed = parse({ ...PRICED, [name]: sent });
    return parsed.success ? (parsed.data as never)[name] : 'refused';
  };

  it.each(BOOLEANS)('reads %s "True", "TRUE" and "tRuE" as true', (name) => {
    for (const sent of ['True', 'TRUE', 'tRuE']) {
      expect(read(name, sent), sent).toBe(true);
    }
  });

  it.each(BOOLEANS)(
    'reads %s "False", "FALSE" and "fAlSe" as false',
    (name) => {
      for (const sent of ['False', 'FALSE', 'fAlSe']) {
        expect(read(name, sent), sent).toBe(false);
      }
    },
  );

  it.each(BOOLEANS)('reads null %s as absent', (name) => {
    expect(read(name, null)).toBeUndefined();
  });

  // One case choice for each letter of the word, so that every spelling can occur.
  const spelling = (word: string) =>
    fc
      .tuple(...[...word].map(() => fc.boolean()))
      .map((upper) =>
        [...word].map((c, i) => (upper[i] ? c.toUpperCase() : c)).join(''),
      );

  it.each(BOOLEANS)(
    'reads every spelling of "true" and of "false" in %s as that boolean (property)',
    (name) => {
      fc.assert(
        fc.property(spelling('true'), spelling('false'), (yes, no) => {
          expect(read(name, yes)).toBe(true);
          expect(read(name, no)).toBe(false);
        }),
      );
    },
  );

  it.each(BOOLEANS)(
    'refuses any text that is no spelling of "true" or "false" in %s, with the message that shows it (property)',
    async (name) => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .oneof(fc.string(), fc.constantFrom('ſ', 'İ', 'ı', 'K'))
            .filter((text) => !['true', 'false'].includes(text.toLowerCase())),
          async (given) => {
            expect(read(name, given)).toBe('refused');
            expect(await messageOf({ ...PRICED, [name]: given })).toBe(
              `Invalid arguments. ${name}: must be true or false, sent as a boolean or as the text "true" or "false"; got ${JSON.stringify(given)}.`,
            );
          },
        ),
      );
    },
  );

  it.each(BOOLEANS)('never throws on any value of %s (property)', (name) => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parse({ ...PRICED, [name]: value })).not.toThrow();
      }),
    );
  });

  // A free model and a paid one, as the API lists them.
  const template = recordedModelsList.data[0] as Record<string, unknown>;
  const listing = {
    data: [
      { ...template, id: 'f/free', pricing: { prompt: '0', completion: '0' } },
      {
        ...template,
        id: 'p/paid',
        pricing: { prompt: '0.000000015', completion: '0.000000045' },
      },
    ],
    total_count: 2,
    links: { next: null },
  };
  const search = async (paidOnly: unknown) => {
    nock(HOST).get('/api/v1/models').query(true).reply(200, listing);
    const result = await callTool(
      TOOLS,
      'search_models',
      JSON.stringify({ ...PRICED, paid_only: paidOnly }),
      { client, timeoutMs: 60_000, catalog: createCatalogCache() },
    );
    if (!result.ok) throw new Error(result.message);
    return JSON.stringify(result.value);
  };

  it('does not change the call: "True", "TRUE" and true give the same result', async () => {
    const reference = await search(true);
    expect(await search('True')).toBe(reference);
    expect(await search('TRUE')).toBe(reference);
  });

  it('drops free models for paid_only "True", as for true, and keeps them for "False"', async () => {
    const listed = async (paidOnly: unknown) =>
      (
        JSON.parse(await search(paidOnly)) as { models: { id: string }[] }
      ).models.map((model) => model.id);
    expect(await listed('True')).toEqual(['p/paid']);
    expect(await listed('False')).toEqual(['f/free', 'p/paid']);
  });
});

describe('search_models advice on paid_only', () => {
  interface Node {
    description?: string;
  }
  const [tool] = functionTools([searchModels]) as unknown as {
    function: {
      description: string;
      parameters: { properties: Record<string, Node> };
    };
  }[];
  const properties = tool?.function.parameters.properties ?? {};
  const texts: [string, string][] = [
    ['the tool description', tool?.function.description ?? ''],
    ...Object.entries(properties).map(([name, node]): [string, string] => [
      name,
      node.description ?? '',
    ]),
    ['the system message', INSTRUCTIONS],
  ];
  const sentences = (text: string): string[] =>
    text.split(/(?<=[.;])\s+/).filter((sentence) => sentence !== '');
  const advice = /\b(?:use|add|set|send|pass)\b[^.;]*\bpaid_only\b/i;

  it.each(['sort', 'paid_only'])(
    'says in the description of %s to use paid_only only when the user asks for a paid model',
    (name) => {
      const text = properties[name]?.description ?? '';
      expect(text).toMatch(/only when the user asks for a paid model/i);
      expect(text).toMatch(/a free model is (?:otherwise )?a valid answer/i);
    },
  );

  // A guard on the wording, not a proof: advice phrased with another verb would pass.
  it('ties every sentence that advises paid_only to the user asking for a paid model', () => {
    const advising = texts.flatMap(([where, text]) =>
      sentences(text)
        .filter((sentence) => advice.test(sentence))
        .map((sentence) => [where, sentence] as const),
    );
    expect(advising.length).toBeGreaterThan(0);
    for (const [where, sentence] of advising) {
      expect(sentence, where).toMatch(/asks for a paid model/i);
    }
  });

  it('no longer says to add paid_only to skip free models', () => {
    for (const [where, text] of texts) {
      expect(text, where).not.toMatch(/add paid_only to skip free models/i);
    }
  });

  it('names no model slug in the advice', () => {
    const advising = texts
      .flatMap(([, text]) => sentences(text))
      .filter((sentence) => /paid_only|free model/i.test(sentence));
    for (const sentence of advising) {
      expect(sentence).not.toMatch(/\b[a-z0-9-]+\/[a-z0-9.:-]+\b/i);
    }
  });
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
      expect(properties[name]?.description).toMatch(/any letter case/);
    },
  );
});
