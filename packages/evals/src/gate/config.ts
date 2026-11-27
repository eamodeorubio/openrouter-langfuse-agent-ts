import { parse } from 'yaml';
import { finite, isObject } from '../json.js';

/** What the gate file says: the run it judges and the floors it judges by. */
export interface GateConfig {
  model: string;
  repeat: number;
  k: number;
  /** The floor of the mean pass^k over the cases. */
  mean: number;
  /** The floor of the pass^k of each case, by case id. */
  cases: Record<string, number>;
}

export type ReadConfig =
  | { ok: true; config: GateConfig }
  | { ok: false; message: string };

const KEYS = ['model', 'repeat', 'k', 'mean', 'cases'];

const refuse = (message: string): ReadConfig => ({ ok: false, message });

const isWhole = (value: unknown, min: number): value is number =>
  Number.isInteger(value) && (value as number) >= min;

const isUnit = (value: unknown): value is number =>
  finite(value) && value >= 0 && value <= 1;

/** Reads and checks the text of a gate file. Never throws: a refusal carries the message that names the key. */
export const readGateConfig = (text: string): ReadConfig => {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return refuse(`it is not valid YAML: ${reason}`);
  }
  if (!isObject(raw)) return refuse('it must be a mapping of keys.');
  const unknown = Object.keys(raw).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) {
    return refuse(`unknown key ${unknown.join(', ')}.`);
  }
  const { model, repeat, k, mean, cases } = raw;
  if (typeof model !== 'string' || model === '') {
    return refuse('`model` must be a non-empty string.');
  }
  if (!isWhole(repeat, 1)) {
    return refuse('`repeat` must be a whole number from 1.');
  }
  if (!isWhole(k, 1) || k > repeat) {
    return refuse(`\`k\` must be a whole number from 1 to repeat (${repeat}).`);
  }
  if (!isUnit(mean)) return refuse('`mean` must be a number from 0 to 1.');
  if (!isObject(cases) || Object.keys(cases).length === 0) {
    return refuse('`cases` must be a map of case id to floor, not empty.');
  }
  for (const [id, floor] of Object.entries(cases)) {
    if (!isUnit(floor)) {
      return refuse(
        `the floor of case ${id} in \`cases\` must be a number from 0 to 1.`,
      );
    }
  }
  return {
    ok: true,
    config: { model, repeat, k, mean, cases: cases as Record<string, number> },
  };
};
