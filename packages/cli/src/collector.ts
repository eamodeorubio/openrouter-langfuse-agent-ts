import type { Failure } from './classify.js';
import type { JsonOutput, SuccessOutput } from './output.js';
import type { AskEvent, Completion, Usage } from './types.js';

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
 */
export const createCollector = () => {
  let question: string | undefined;
  let traceId: string | undefined;
  let thinking = '';
  let answer = '';
  let completion: Completion | undefined;

  /** The fields both objects share, those with no value left out. */
  const known = () => ({
    ...(question === undefined ? {} : { question }),
    ...(answer === '' ? {} : { answer }),
    ...(thinking === '' ? {} : { thinking }),
    ...(traceId === undefined ? {} : { traceId }),
  });

  return {
    setQuestion(text: string): void {
      question = text;
    },

    handle(event: AskEvent): void {
      switch (event.kind) {
        case 'thinking':
          thinking += event.text;
          return;
        case 'content':
          answer += event.text;
          return;
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
      const { model, usage } = completion;
      return {
        ...known(),
        success: true,
        model,
        usage: reported(usage),
      } as SuccessOutput;
    },

    failure({ code, message }: Pick<Failure, 'code' | 'message'>): JsonOutput {
      return { ...known(), success: false, error: { code, message } };
    },
  };
};
