import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { CliArgs } from './args.js';
import { ConfigError } from './errors.js';

/** Where Langfuse is and the keys for it. Absent when the run is untraced. */
export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  /** Where the traces are filed in Langfuse, such as `staging`. */
  environment?: string | undefined;
  /** What the traces are attributed to, such as a git commit. */
  release?: string | undefined;
}

export interface Config {
  apiKey: string;
  model: string;
  langfuse?: LangfuseConfig | undefined;
}

type Env = Record<string, string | undefined>;

const LANGFUSE_VARS = [
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
] as const;

/** All three variables make a config, none make `undefined`, and anything between is an error that names what is missing. */
const resolveLangfuse = (env: Env): LangfuseConfig | undefined => {
  const value = (name: (typeof LANGFUSE_VARS)[number]) => env[name]?.trim();
  const missing = LANGFUSE_VARS.filter((name) => !value(name));
  if (missing.length === LANGFUSE_VARS.length) {
    return undefined;
  }
  if (missing.length > 0) {
    throw new ConfigError(
      `Langfuse tracing is half configured: ${missing.join(', ')} not set. Set all three, or none to run without tracing.`,
    );
  }
  return {
    publicKey: value('LANGFUSE_PUBLIC_KEY') as string,
    secretKey: value('LANGFUSE_SECRET_KEY') as string,
    baseUrl: validBaseUrl(value('LANGFUSE_BASE_URL') as string),
    environment: validEnvironment(env.LANGFUSE_TRACING_ENVIRONMENT?.trim()),
    release: env.LANGFUSE_RELEASE?.trim() || undefined,
  };
};

/** The rule Langfuse sets for an environment name. */
const ENVIRONMENT = /^(?!langfuse)[a-z0-9-_]{1,40}$/;

const validEnvironment = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (!ENVIRONMENT.test(value)) {
    throw new ConfigError(
      'LANGFUSE_TRACING_ENVIRONMENT must be 1 to 40 characters of lower case letters, digits, hyphens and underscores, and must not start with "langfuse".',
    );
  }
  return value;
};

const validBaseUrl = (value: string): string => {
  if (
    !URL.canParse(value) ||
    !['http:', 'https:'].includes(new URL(value).protocol)
  ) {
    throw new ConfigError(
      'LANGFUSE_BASE_URL must be an absolute http or https URL, such as https://cloud.langfuse.com.',
    );
  }
  const { username, password } = new URL(value);
  if (username || password) {
    throw new ConfigError(
      'LANGFUSE_BASE_URL must not hold a user name or a password. The keys go in LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.',
    );
  }
  return value.replace(/\/+$/, '');
};

export const resolveConfig = (
  args: Pick<CliArgs, 'model'>,
  env: Env,
): Config => {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      'OPENROUTER_API_KEY is not set. Get a key at https://openrouter.ai/keys.',
    );
  }
  const model = args.model?.trim() || env.OPENROUTER_MODEL?.trim();
  if (!model) {
    throw new ConfigError(
      'No model given. Pass --model or set OPENROUTER_MODEL.',
    );
  }
  return { apiKey, model, langfuse: resolveLangfuse(env) };
};

const readDotenv = async (cwd: string): Promise<Env> => {
  try {
    return parseEnv(await readFile(join(cwd, '.env'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new ConfigError(
      `Cannot read .env in the current directory (${(error as NodeJS.ErrnoException).code}).`,
    );
  }
};

export const loadConfig = async (
  args: Pick<CliArgs, 'model'>,
  env: Env,
  cwd: string,
): Promise<Config> =>
  resolveConfig(args, { ...(await readDotenv(cwd)), ...env });
