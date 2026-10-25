import type { Failure } from './classify.js';
import type { JsonOutput } from './output.js';
import type { AskEvent } from './types.js';

/**
 * Stands in for the presenter under `--json`: it writes nothing, it keeps what
 * the events carry, and hands back the one object when the run has ended.
 */
export const createCollector = () => {
  let question: string | undefined;
  let traceId: string | undefined;
  let thinking = '';
  let answer = '';

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
      }
    },

    /** Only called after an answer: `ask` fails a run that ends without answer text. */
    success(): JsonOutput {
      return { ...known(), success: true } as JsonOutput;
    },

    failure({ code, message }: Pick<Failure, 'code' | 'message'>): JsonOutput {
      return { ...known(), success: false, error: { code, message } };
    },
  };
};
