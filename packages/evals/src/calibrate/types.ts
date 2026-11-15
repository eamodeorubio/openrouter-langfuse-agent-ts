import type { ToolCall } from '../checks/run.js';

/** What Opus says of a rubric about a record. */
export type Verdict = 'yes' | 'no' | 'ambiguous';

/** How a control is bad by construction. */
export type ControlKind =
  | 'answer-swapped'
  | 'figure-invented'
  | 'tools-swapped';

/** One run, or one control made from a run, as the calibration reads and writes it. */
export interface CalibrationRecord {
  id: string;
  case: string;
  model: string;
  repeat: number;
  prompt: string;
  transcript: { toolCalls: ToolCall[]; answer: string };
  /** The text Jev is sent, for each rubric the run was asked. */
  states: Record<string, string>;
  /** The probability of yes Jev gave, for each rubric it answered. */
  jevAssertScores: Record<string, number>;
  /** Set on a control: how it is bad, and the rubrics it is expected to fail. */
  control?: ControlKind;
  expectedFail?: string[];
  /** The answers of Opus, for each rubric it was asked. */
  opusScore?: Record<string, Verdict>;
  opusReason?: Record<string, string>;
}
