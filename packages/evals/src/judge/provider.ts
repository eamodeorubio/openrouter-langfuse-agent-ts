import { type ApiProvider, loadApiProvider } from 'promptfoo';
import { finite, isObject } from '../json.js';
import { stateBytes } from './state.js';

/** The model that grades: Jev 1.14, as OpenRouter names it. */
export const JUDGE_MODEL = 'typesafe/jev-1.14';

/** Above this many bytes Jev answers in a slower, less accurate long-context mode, so no score is asked for. */
export const STATE_LIMIT_BYTES = 32_000;

/** Where the judge asks, unless `EVAL_JUDGE_URL` says otherwise: the tests point it at a loopback server. */
export const DEFAULT_JUDGE_URL = 'https://openrouter.ai/api';

const KEY = 'OPENROUTER_API_KEY';

/**
 * The grader of the rubrics: promptfoo's own provider for Jev, behind two
 * checks of ours. It asks nothing of Jev, and answers with an error, when the
 * state is over the limit or when there is no key. The key comes from the
 * environment when a rubric is graded, and is written in no config.
 */
export default class JudgeProvider {
  private readonly threshold: number;
  private inner: Promise<ApiProvider> | undefined;

  constructor(options: { id?: string; config?: unknown } = {}) {
    const config = isObject(options.config) ? options.config : {};
    const threshold = config.threshold;
    if (!finite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(
        `The judge needs a threshold from 0 to 1 in its config, got ${JSON.stringify(threshold)}.`,
      );
    }
    this.threshold = threshold;
  }

  id(): string {
    return 'ask-openrouter-judge';
  }

  async callApi(
    prompt: string,
    context?: Parameters<ApiProvider['callApi']>[1],
    callOptions?: Parameters<ApiProvider['callApi']>[2],
  ) {
    const key = process.env[KEY];
    if (!key) {
      return { error: `${KEY} is not set, so the rubric was not graded.` };
    }
    const state = context?.vars?.output;
    if (typeof state !== 'string') {
      return {
        error: 'The rubric has no state to grade, so it was not graded.',
      };
    }
    const bytes = stateBytes(state);
    if (bytes > STATE_LIMIT_BYTES) {
      return {
        error: `The state is too large: ${bytes} bytes, over the limit of ${STATE_LIMIT_BYTES}. Above it Jev answers in a slower, less accurate mode, so the rubric was not graded.`,
      };
    }
    this.inner ??= loadApiProvider(`typesafe:${JUDGE_MODEL}`, {
      options: {
        config: {
          apiBaseUrl: process.env.EVAL_JUDGE_URL || DEFAULT_JUDGE_URL,
          apiKey: key,
          threshold: this.threshold,
        },
      },
    });
    return (await this.inner).callApi(prompt, context, callOptions);
  }
}
