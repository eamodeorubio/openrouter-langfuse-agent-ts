import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { z } from 'zod';
import { toApiError } from '../failures.js';
import { withRetry } from '../retry.js';
import { isoDate, shapePricing, snakeKeys } from './shape.js';
import type { Tool } from './types.js';

const parameters = z
  .object({
    slug: z
      .string()
      .regex(/^(?!\.+\/)[^/\s]+\/(?!\.+$)[^/\s]+$/)
      .describe(
        'The model slug as `author/name`, with an optional `:variant` suffix, such as `openai/gpt-5` or `openai/gpt-5:free`.',
      ),
  })
  .strict();

export const getModel: Tool<typeof parameters> = {
  name: 'get_model',
  description:
    'Get the details of one OpenRouter model by its slug: description, context length, modalities, supported parameters, prices in USD per million tokens, reasoning support and benchmark scores.',
  parameters,
  async run({ slug }, { client, timeoutMs }) {
    // The schema guarantees exactly one slash, with text on both sides.
    const slash = slug.indexOf('/');
    const author = slug.slice(0, slash);
    const name = slug.slice(slash + 1);
    try {
      const { data: model } = await withRetry(() =>
        client.models.get({ author, slug: name }, { timeoutMs }),
      );
      return {
        ok: true,
        value: {
          id: model.id,
          name: model.name,
          description: model.description,
          created: isoDate(model.created),
          knowledge_cutoff: model.knowledgeCutoff,
          expiration_date: model.expirationDate,
          context_length: model.contextLength,
          max_completion_tokens: model.topProvider.maxCompletionTokens,
          input_modalities: model.architecture.inputModalities,
          output_modalities: model.architecture.outputModalities,
          tokenizer: model.architecture.tokenizer,
          supported_parameters: model.supportedParameters,
          pricing: shapePricing(model.pricing),
          reasoning: snakeKeys(model.reasoning),
          benchmarks: snakeKeys(model.benchmarks),
        },
      };
    } catch (error) {
      if (error instanceof OpenRouterError && error.statusCode === 404) {
        return { ok: false, message: `Model not found: ${slug}` };
      }
      const known = toApiError(error, timeoutMs);
      if (known) {
        return { ok: false, message: known.message };
      }
      throw error;
    }
  },
};
