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

describe('resolveConfig, Langfuse tracing', () => {
  const base = { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' };
  const VARS = [
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'LANGFUSE_BASE_URL',
  ] as const;
  const full = {
    LANGFUSE_PUBLIC_KEY: 'pk-lf-1',
    LANGFUSE_SECRET_KEY: 'sk-lf-2',
    LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
  };

  it('is off when none of the three variables is set', () => {
    expect(resolveConfig(flags(), base).langfuse).toBeUndefined();
  });

  it('is on, with the three values, when all are set', () => {
    expect(resolveConfig(flags(), { ...base, ...full }).langfuse).toEqual({
      publicKey: 'pk-lf-1',
      secretKey: 'sk-lf-2',
      baseUrl: 'https://cloud.langfuse.com',
    });
  });

  it('trims the values and drops trailing slashes from the base URL', () => {
    const env = {
      ...base,
      LANGFUSE_PUBLIC_KEY: ' pk\n',
      LANGFUSE_SECRET_KEY: ' sk ',
      LANGFUSE_BASE_URL: ' http://localhost:3000// ',
    };
    expect(resolveConfig(flags(), env).langfuse).toEqual({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'http://localhost:3000',
    });
  });

  it('tells the user what to do, in one sentence', () => {
    expect(() =>
      resolveConfig(flags(), {
        ...base,
        LANGFUSE_PUBLIC_KEY: 'pk',
      }),
    ).toThrow(
      'Langfuse tracing is half configured: LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL not set. Set all three, or none to run without tracing.',
    );
  });

  it.each(['https:', 'httpx://host'])(
    'rejects %s, which is not an http or https URL',
    (url) => {
      expect(() =>
        resolveConfig(flags(), { ...base, ...full, LANGFUSE_BASE_URL: url }),
      ).toThrow(/LANGFUSE_BASE_URL/);
    },
  );

  it('counts a blank value as unset', () => {
    const env = { ...base, ...full, LANGFUSE_SECRET_KEY: '   ' };
    expect(() => resolveConfig(flags(), env)).toThrow(/LANGFUSE_SECRET_KEY/);
    expect(
      resolveConfig(flags(), {
        ...base,
        LANGFUSE_PUBLIC_KEY: '',
        LANGFUSE_SECRET_KEY: ' ',
        LANGFUSE_BASE_URL: '\t',
      }).langfuse,
    ).toBeUndefined();
  });

  it('names exactly the missing variables for any strict subset of the three', () => {
    fc.assert(
      fc.property(
        fc
          .subarray([...VARS])
          .filter((set) => set.length > 0 && set.length < VARS.length),
        (present) => {
          const env: Record<string, string> = { ...base };
          for (const name of present) {
            env[name] = full[name];
          }
          const missing = VARS.filter((name) => !present.includes(name));
          let message = '';
          try {
            resolveConfig(flags(), env);
          } catch (error) {
            expect(error).toBeInstanceOf(ConfigError);
            message = (error as Error).message;
          }
          for (const name of VARS) {
            expect(message.includes(name)).toBe(missing.includes(name));
          }
        },
      ),
    );
  });

  it.each([
    'cloud.langfuse.com',
    'ftp://cloud.langfuse.com',
    '//cloud.langfuse.com',
    'http://',
    'not a url',
  ])(
    'rejects %s as a base URL, naming the variable and not the keys',
    (url) => {
      const env = { ...base, ...full, LANGFUSE_BASE_URL: url };
      expect(() => resolveConfig(flags(), env)).toThrow(/LANGFUSE_BASE_URL/);
      expect(() => resolveConfig(flags(), env)).not.toThrow(/sk-lf-2|pk-lf-1/);
    },
  );

  it.each([
    'https://user:pass@cloud.langfuse.com',
    'https://user@cloud.langfuse.com',
    'https://:pass@cloud.langfuse.com',
  ])(
    'rejects %s, which holds a user name or a password, without showing it',
    (url) => {
      const env = { ...base, ...full, LANGFUSE_BASE_URL: url };
      expect(() => resolveConfig(flags(), env)).toThrow(
        /LANGFUSE_BASE_URL must not hold a user name or a password/,
      );
      expect(() => resolveConfig(flags(), env)).not.toThrow(/user:pass|:pass/);
    },
  );

  it('has no environment and no release unless they are set', () => {
    const { langfuse } = resolveConfig(flags(), { ...base, ...full });
    expect(langfuse?.environment).toBeUndefined();
    expect(langfuse?.release).toBeUndefined();
  });

  it('reads the environment and the release, trimmed', () => {
    const { langfuse } = resolveConfig(flags(), {
      ...base,
      ...full,
      LANGFUSE_TRACING_ENVIRONMENT: ' staging ',
      LANGFUSE_RELEASE: ' v1.2.3\n',
    });
    expect(langfuse?.environment).toBe('staging');
    expect(langfuse?.release).toBe('v1.2.3');
  });

  it('counts a blank environment or release as unset', () => {
    const { langfuse } = resolveConfig(flags(), {
      ...base,
      ...full,
      LANGFUSE_TRACING_ENVIRONMENT: '  ',
      LANGFUSE_RELEASE: '',
    });
    expect(langfuse?.environment).toBeUndefined();
    expect(langfuse?.release).toBeUndefined();
  });

  it.each([
    'Staging',
    'has space',
    'langfuse-internal',
    'a'.repeat(41),
    'dots.here',
  ])('rejects %s as an environment, naming the variable', (environment) => {
    expect(() =>
      resolveConfig(flags(), {
        ...base,
        ...full,
        LANGFUSE_TRACING_ENVIRONMENT: environment,
      }),
    ).toThrow(/LANGFUSE_TRACING_ENVIRONMENT/);
  });

  it.each(['production', 'staging-2', 'a_b', 'a'.repeat(40), 'x'])(
    'accepts %s as an environment',
    (environment) => {
      expect(
        resolveConfig(flags(), {
          ...base,
          ...full,
          LANGFUSE_TRACING_ENVIRONMENT: environment,
        }).langfuse?.environment,
      ).toBe(environment);
    },
  );

  it('ignores the environment and the release when tracing is off', () => {
    expect(
      resolveConfig(flags(), {
        ...base,
        LANGFUSE_TRACING_ENVIRONMENT: 'Not Valid',
        LANGFUSE_RELEASE: 'r',
      }).langfuse,
    ).toBeUndefined();
  });

  it('checks the key and the model before tracing', () => {
    expect(() => resolveConfig(flags(), { LANGFUSE_PUBLIC_KEY: 'pk' })).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });
});
