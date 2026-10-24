import type { Sink } from '../src/types.js';

/** What a run wrote to its two channels. */
export interface Written {
  stdout: string;
  stderr: string;
}

/** A sink that appends what is written to one channel of `written`. */
export const sink = (written: Written, channel: keyof Written): Sink => ({
  write: (text: string) => {
    written[channel] += text;
  },
});
