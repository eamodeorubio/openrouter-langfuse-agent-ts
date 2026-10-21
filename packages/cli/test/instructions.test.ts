import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from '../src/instructions.js';

describe('the system message', () => {
  it.each([
    ['the job', /OpenRouter/],
    ['cost against need', /cost-effective/],
    ['the unit of every price', /USD per million tokens/],
    ['tools before memory', /Never answer from memory/],
    ['independent calls together', /call the tools together/],
  ])('tells the model %s', (_what, pattern) => {
    expect(INSTRUCTIONS).toMatch(pattern);
  });

  it('names no tool, so it stays true whichever tools are offered', () => {
    expect(INSTRUCTIONS).not.toMatch(/get_model|search_models/);
  });
});
