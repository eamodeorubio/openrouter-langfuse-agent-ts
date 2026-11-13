import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  authorsOf,
  isGrounded,
  namedModels,
  slugTokens,
} from '../src/checks/slugs.js';

const SHAPE =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._~-]*(:[a-z0-9][a-z0-9._-]*)?$/;

const authors = new Set(['openai', 'nvidia', 'anthropic']);

describe('the model names in an answer', () => {
  it.each([
    ['Use openai/gpt-oss-20b.', ['openai/gpt-oss-20b']],
    [
      'nvidia/nemotron-3-ultra-550b-a55b:free, then',
      ['nvidia/nemotron-3-ultra-550b-a55b:free'],
    ],
    ['see https://openrouter.ai/models', []],
    ['input/output and 24/7', []],
    ['`fakeco/x-1`', ['fakeco/x-1']],
    [
      '**openai/gpt-5** (cheap) and openai/gpt-5-mini!',
      ['openai/gpt-5', 'openai/gpt-5-mini'],
    ],
    ['OpenAI/GPT-5 twice: openai/gpt-5', ['openai/gpt-5']],
    ['a path a/b/c here', []],
  ])('in %j are %j', (answer, expected) => {
    expect(namedModels(answer, authors)).toEqual(expected);
  });

  it('never throws, and names only slug-shaped tokens', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        for (const slug of namedModels(text, authors)) {
          expect(slug).toMatch(SHAPE);
        }
      }),
    );
  });

  it('finds a slug of a known author written in prose', () => {
    const word = fc.stringMatching(/^[a-z][a-z0-9]{1,7}$/);
    const name = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,8}[a-z0-9]$/);
    const variant = fc.option(fc.stringMatching(/^[a-z]{2,6}$/), {
      nil: undefined,
    });
    fc.assert(
      fc.property(word, name, variant, (author, model, suffix) => {
        const slug = `${author}/${model}${suffix ? `:${suffix}` : ''}`;
        expect(namedModels(`Use ${slug}.`, new Set([author]))).toEqual([slug]);
      }),
    );
  });

  it('ignores a slug inside a URL, whatever the author', () => {
    expect(
      namedModels('docs: https://openai/gpt-5/page', new Set(['openai'])),
    ).toEqual([]);
  });
});

describe('the model names in the sources', () => {
  it('are every slug-shaped token, whoever the author', () => {
    expect(
      slugTokens('{"id":"openai/gpt-5","name":"x"} and nvidia/nemotron:free'),
    ).toEqual(['openai/gpt-5', 'nvidia/nemotron:free']);
  });

  it('give the authors the answer check accepts', () => {
    expect(authorsOf(['openai/gpt-5', 'nvidia/nemotron:free'])).toEqual(
      new Set(['openai', 'nvidia']),
    );
  });
});

describe('grounding', () => {
  const sources = new Set(['a/b:free', 'c/d']);

  it.each([
    ['a/b', true],
    ['a/b:free', true],
    ['a/b:beta', false],
    ['c/d', true],
    ['c/d:free', false],
    ['x/y', false],
  ])('of %s in the sources is %s', (slug, grounded) => {
    expect(isGrounded(slug, sources)).toBe(grounded);
  });
});

describe('the edges of the model names', () => {
  it('needs the backtick on both sides', () => {
    expect(namedModels('`fakeco/x-1 and more', new Set())).toEqual([]);
    expect(namedModels('and fakeco/x-1` here', new Set())).toEqual([]);
    expect(namedModels('and `fakeco/x-1` here', new Set())).toEqual([
      'fakeco/x-1',
    ]);
  });

  it('reads a slug right after a URL', () => {
    expect(
      namedModels(
        'see https://openrouter.ai/models openai/gpt-5',
        new Set(['openai']),
      ),
    ).toEqual(['openai/gpt-5']);
  });

  it('finds the position of each slug, not only the first', () => {
    expect(namedModels('`a/b` and a/b and `c/d`', new Set(['a']))).toEqual([
      'a/b',
      'c/d',
    ]);
  });
});
