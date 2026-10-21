import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { CliArgs } from './args.js';
import { ConfigError } from './errors.js';

export interface Config {
  apiKey: string;
  model: string;
}

type Env = Record<string, string | undefined>;

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
  return { apiKey, model };
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
