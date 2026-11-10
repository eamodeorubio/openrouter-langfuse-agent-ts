import type { CliArgs } from './args.js';
import type { Failure } from './classify.js';
import type { JsonOutput, SuccessOutput } from './output.js';
import { redactAll } from './text.js';
import type { AskEvent, Completion, Usage } from './types.js';

type ToolCallEntry = SuccessOutput['toolCalls'][number];

/** The usage with the optional figures that nobody reported left out. */
const reported = ({
  promptTokens,
  completionTokens,
  totalTokens,
  reasoningTokens,
  cachedTokens,
  cost,
}: Usage) => ({
  promptTokens,
  completionTokens,
  totalTokens,
  ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  ...(cachedTokens === undefined ? {} : { cachedTokens }),
  ...(cost === undefined ? {} : { cost }),
});

/**
 * Stands in for the presenter under `--json`: it writes nothing, it keeps what
 * the events carry, and hands back the one object when the run has ended.
 *
 * Besides the events it is told, in this order: `setArgs` once the arguments
 * parse, `setSecrets` with what is known then and again once the configuration
 * is, `setQuestion` once the question is read, and `startRun` just before the
 * first request. An object built earlier leaves out what it was not told.
 */
export const createCollector = () => {
  let question: string | undefined;
  let traceId: string | undefined;
  let thinking = '';
  let answer = '';
  let completion: Completion | undefined;
  let parsed: CliArgs | undefined;
  let redact = (text: string): string => text;
  let started = false;
  const toolCalls: ToolCallEntry[] = [];

  /** The arguments as the object shows them: what was given, with the secrets out. */
  const argsObject = (): NonNullable<SuccessOutput['args']> | undefined =>
    parsed && {
      verbose: parsed.verbose,
      ...(parsed.thinking === undefined ? {} : { thinking: parsed.thinking }),
      ...(parsed.model === undefined ? {} : { model: redact(parsed.model) }),
    };

  /** The fields both objects share, those with no value left out. */
  const known = () => ({
    ...(question === undefined ? {} : { question }),
    ...(answer === '' ? {} : { answer }),
    ...(thinking === '' ? {} : { thinking }),
    ...(traceId === undefined ? {} : { traceId }),
    ...(parsed === undefined ? {} : { args: argsObject() }),
  });

  return {
    setQuestion(text: string): void {
      question = text;
    },

    /** The arguments the CLI parsed. Not called when they were rejected. */
    setArgs(value: CliArgs): void {
      parsed = value;
    },

    /** The values the arguments must not show. Set again once the configuration is known. */
    setSecrets(values: readonly (string | undefined)[]): void {
      redact = (text) => redactAll(text, values);
    },

    /** The first request to the model is about to be sent: from here a failure lists its tool calls. */
    startRun(): void {
      started = true;
    },

    handle(event: AskEvent): void {
      switch (event.kind) {
        case 'thinking':
          thinking += event.text;
          return;
        case 'content':
          answer += event.text;
          return;
        case 'tool-call': {
          const { kind: _kind, ...entry } = event;
          toolCalls.push(entry);
          return;
        }
        case 'trace':
          traceId = event.id;
          return;
        case 'done':
          completion = event;
          return;
      }
    },

    /** Only called after a `done` event, which comes with the answer: `ask` fails a run that ends without answer text or without usage. */
    success(): SuccessOutput {
      if (!completion) {
        throw new Error('A success object needs the completion of the run.');
      }
      if (!parsed) {
        throw new Error('A success object needs the arguments of the run.');
      }
      const { model, usage } = completion;
      return {
        ...known(),
        success: true,
        model,
        usage: reported(usage),
        toolCalls: [...toolCalls],
      } as SuccessOutput;
    },

    failure({ code, message }: Pick<Failure, 'code' | 'message'>): JsonOutput {
      return {
        ...known(),
        success: false,
        ...(started ? { toolCalls: [...toolCalls] } : {}),
        error: { code, message },
      };
    },
  };
};
