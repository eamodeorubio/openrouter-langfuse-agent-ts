import { type ExecException, execFile } from 'node:child_process';
import { resolveCli } from '../cliPath.js';
import { finite, isObject, parseJson } from '../json.js';
import { optionalSnapshot } from '../oracle/catalog.js';
import { resolvePlaceholders } from './placeholders.js';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface CliProviderConfig {
  /** The CLI entry to start. Defaults to `EVAL_CLI`, then to the built CLI. */
  cli?: string;
  /** How long one CLI run may take, in milliseconds. */
  timeoutMs?: number;
}

export interface ProviderResponse {
  output?: unknown;
  error?: string;
  cost?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

interface CallContext {
  vars?: Record<string, unknown>;
}

interface Finished {
  stdout: string;
  stderr: string;
  failure?: ExecException;
}

/** The tokens and the cost the CLI reported, in the fields promptfoo reports. */
const usageOf = (
  success: Record<string, unknown>,
): Pick<ProviderResponse, 'cost' | 'tokenUsage'> => {
  const usage = success.usage;
  if (!isObject(usage)) return {};
  const { promptTokens, completionTokens, totalTokens, cost } = usage;
  return {
    ...(finite(promptTokens) && finite(completionTokens) && finite(totalTokens)
      ? {
          tokenUsage: {
            prompt: promptTokens,
            completion: completionTokens,
            total: totalTokens,
          },
        }
      : {}),
    ...(finite(cost) ? { cost } : {}),
  };
};

/** Starts the CLI with an argument array, so no shell reads the question. */
const startCli = (
  cli: string,
  args: string[],
  timeoutMs: number,
): Promise<Finished> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (failure, stdout, stderr) =>
        resolve({ stdout, stderr, ...(failure ? { failure } : {}) }),
    );
  });

/** A promptfoo provider that answers a question by running the built CLI with `--json`. */
export default class CliProvider {
  private readonly cli: string;
  private readonly timeoutMs: number;
  private readonly providerId: string;

  constructor(options: { id?: string; config?: CliProviderConfig } = {}) {
    const config = options.config ?? {};
    this.cli = resolveCli(config.cli);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.providerId = options.id ?? 'ask-openrouter-cli';
  }

  id(): string {
    return this.providerId;
  }

  async callApi(
    prompt: string,
    context: CallContext = {},
  ): Promise<ProviderResponse> {
    const model = context.vars?.model;
    if (typeof model !== 'string' || model.trim() === '') {
      return {
        error:
          'vars.model is required: the case must name the model that answers. The provider does not read OPENROUTER_MODEL.',
      };
    }

    let question: string;
    try {
      question = resolvePlaceholders(
        prompt,
        optionalSnapshot(),
        (process.env.EVAL_MODELS ?? '').split(',').filter((id) => id !== ''),
      );
    } catch (error) {
      // A pick that has no model, or a snapshot that cannot be read: both end the call.
      return { error: (error as Error).message };
    }

    const { stdout, stderr, failure } = await startCli(
      this.cli,
      ['--json', '--model', model, '-q', question],
      this.timeoutMs,
    );

    if (failure?.killed) {
      return {
        error: `The CLI timed out after ${this.timeoutMs} ms and was killed.`,
      };
    }
    if (failure) {
      return {
        error:
          typeof failure.code === 'number'
            ? `The CLI exited with code ${failure.code}: ${stderr.trim()}`
            : `The CLI did not finish: ${failure.signal ?? failure.message}`,
      };
    }

    const parsed = parseJson(stdout);
    if (!isObject(parsed) || parsed.success !== true) {
      return {
        error: `The CLI wrote unreadable output, not a --json success object: ${stdout.slice(0, 200)}`,
      };
    }
    return { output: parsed, ...usageOf(parsed) };
  }
}
