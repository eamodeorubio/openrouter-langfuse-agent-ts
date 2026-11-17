import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from '../src/instructions.js';
import { DEFAULT_MIX } from '../src/tools/priceSort.js';

describe('the system message', () => {
  it.each([
    ['the job', /OpenRouter/],
    ['cost against need', /cost-effective/],
    ['the unit of every price', /USD per million tokens/],
    ['tools before memory', /Never answer from memory/],
    ['independent calls together', /call the tools together/],
    ['arithmetic goes to the calculator', /arithmetic with the calculate tool/],
    [
      'to show the formula and result of a cost',
      /show the formula and its result/,
    ],
  ])('tells the model %s', (_what, pattern) => {
    expect(INSTRUCTIONS).toMatch(pattern);
  });

  it('says what to assume for a question about the cheapest model that gives no usage', () => {
    expect(INSTRUCTIONS).toMatch(/says nothing about usage/);
    expect(INSTRUCTIONS).toMatch(/blend of/);
    expect(INSTRUCTIONS).toMatch(/three input tokens for every output token/);
    expect(INSTRUCTIONS).toMatch(/unless the user says otherwise/);
    expect(INSTRUCTIONS).toMatch(/say which mix you assumed/);
  });

  it('assumes the mix that the blended sorts use when they get none, so the model and the tool agree', () => {
    const words: Record<number, string> = { 3: 'three' };
    expect(INSTRUCTIONS).toContain(
      `${words[DEFAULT_MIX]} input tokens for every output token`,
    );
  });

  it('lets one price alone decide when only that price matters', () => {
    expect(INSTRUCTIONS).toMatch(/one price alone matters/);
    expect(INSTRUCTIONS).toMatch(/rank by that price alone/);
    expect(INSTRUCTIONS).toMatch(/input for a long prompt/);
  });

  it('names no catalog tool, so it stays true whichever of them are offered', () => {
    expect(INSTRUCTIONS).not.toMatch(/get_model|search_models/);
  });
});
