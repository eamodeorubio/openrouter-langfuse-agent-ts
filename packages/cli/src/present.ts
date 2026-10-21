import { formatStatus } from './status.js';
import type { AskEvent, Sink } from './types.js';

const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

export interface PresenterOptions {
  stdout: Sink;
  stderr: Sink;
  /** `true` for --thinking, `false` for --no-thinking, `undefined` to follow stderr. */
  thinking: boolean | undefined;
  /** The value of `NO_COLOR`; any non-empty value turns styling off. */
  noColor: string | undefined;
}

/**
 * Decides what goes where. The answer goes to stdout as it arrives, the
 * thinking to stderr (dimmed on a terminal), and the status lines to stderr
 * once the stream has ended.
 */
export const createPresenter = ({
  stdout,
  stderr,
  thinking,
  noColor,
}: PresenterOptions) => {
  const showThinking = thinking ?? Boolean(stderr.isTTY);
  const styled = Boolean(stderr.isTTY) && !noColor;
  // The last piece of thinking written; undefined while no thinking line is open.
  let lastThinking: string | undefined;
  let answerEndedLine = true;

  const closeThinking = (beforeAnswer: boolean) => {
    if (lastThinking === undefined) {
      return;
    }
    const endedLine = lastThinking.endsWith('\n');
    lastThinking = undefined;
    if (styled) {
      stderr.write(RESET);
    }
    if (!endedLine) {
      stderr.write('\n');
    }
    if (beforeAnswer && stdout.isTTY) {
      stderr.write('\n');
    }
  };

  return {
    handle(event: AskEvent): void {
      switch (event.kind) {
        case 'thinking':
          if (!showThinking) {
            return;
          }
          if (lastThinking === undefined && styled) {
            stderr.write(DIM);
          }
          stderr.write(event.text);
          lastThinking = event.text;
          return;
        case 'content':
          closeThinking(true);
          stdout.write(event.text);
          answerEndedLine = event.text.endsWith('\n');
          return;
        case 'done':
          closeThinking(false);
          stdout.write('\n');
          stderr.write(formatStatus(event));
          return;
      }
    },

    /** The stream failed: end the lines that are open, and nothing else. */
    interrupt(): void {
      closeThinking(false);
      if (!answerEndedLine) {
        stdout.write('\n');
        answerEndedLine = true;
      }
    },
  };
};
