import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

const flags = (model?: string) => ({ question: undefined, model });

describe('resolveConfig', () => {
  it('returns the key and the model', () => {
    expect(
      resolveConfig(flags(), {
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_MODEL: 'm',
      }),
    ).toEqual({
      apiKey: 'k',
      model: 'm',
    });
  });

  it('trims the key and the model', () => {
    expect(resolveConfig(flags(' f '), { OPENROUTER_API_KEY: ' k\n' })).toEqual(
      { apiKey: 'k', model: 'f' },
    );
  });

  it.each([
    ['unset', {}],
    ['empty', { OPENROUTER_API_KEY: '' }],
    ['blank', { OPENROUTER_API_KEY: ' \t' }],
  ])('names OPENROUTER_API_KEY when it is %s', (_name, env) => {
    expect(() => resolveConfig(flags('m'), env)).toThrow(ConfigError);
    expect(() => resolveConfig(flags('m'), env)).toThrow(/OPENROUTER_API_KEY/);
  });

  it('names both model sources when there is no model', () => {
    expect(() => resolveConfig(flags(), { OPENROUTER_API_KEY: 'k' })).toThrow(
      /--model.*OPENROUTER_MODEL/s,
    );
  });

  it('picks the flag, else the environment, else fails, for any flag and environment values', () => {
    const text = fc.oneof(
      fc.string(),
      fc.constantFrom('', ' ', '\n', ' m '),
      fc.constant(undefined),
    );
    fc.assert(
      fc.property(text, text, (flag, fromEnv) => {
        const env = {
          OPENROUTER_API_KEY: 'k',
          ...(fromEnv === undefined ? {} : { OPENROUTER_MODEL: fromEnv }),
        };
        const expected = flag?.trim() || fromEnv?.trim();
        if (expected) {
          expect(resolveConfig(flags(flag), env).model).toBe(expected);
        } else {
          expect(() => resolveConfig(flags(flag), env)).toThrow(ConfigError);
        }
      }),
    );
  });
});

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'config-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads values from .env in the given directory', async () => {
    await writeFile(
      join(dir, '.env'),
      'OPENROUTER_API_KEY=filekey\nOPENROUTER_MODEL=file/model\n',
    );
    expect(await loadConfig(flags(), {}, dir)).toEqual({
      apiKey: 'filekey',
      model: 'file/model',
    });
  });

  it('lets the real environment win over .env', async () => {
    await writeFile(
      join(dir, '.env'),
      'OPENROUTER_API_KEY=filekey\nOPENROUTER_MODEL=file/model\n',
    );
    expect(
      await loadConfig(flags(), { OPENROUTER_MODEL: 'env/model' }, dir),
    ).toEqual({
      apiKey: 'filekey',
      model: 'env/model',
    });
  });

  it('lets --model win over both', async () => {
    await writeFile(
      join(dir, '.env'),
      'OPENROUTER_API_KEY=k\nOPENROUTER_MODEL=file/model\n',
    );
    expect(
      (
        await loadConfig(
          flags('flag/model'),
          { OPENROUTER_MODEL: 'env/model' },
          dir,
        )
      ).model,
    ).toBe('flag/model');
  });

  it('works without a .env file', async () => {
    expect(
      await loadConfig(flags('m'), { OPENROUTER_API_KEY: 'k' }, dir),
    ).toEqual({ apiKey: 'k', model: 'm' });
  });

  it('fails with a ConfigError when .env cannot be read', async () => {
    await mkdir(join(dir, '.env'));
    await expect(
      loadConfig(flags('m'), { OPENROUTER_API_KEY: 'k' }, dir),
    ).rejects.toThrow(ConfigError);
  });

  it('names .env in the error', async () => {
    await mkdir(join(dir, '.env'));
    await expect(
      loadConfig(flags('m'), { OPENROUTER_API_KEY: 'k' }, dir),
    ).rejects.toThrow(/\.env/);
  });
});
