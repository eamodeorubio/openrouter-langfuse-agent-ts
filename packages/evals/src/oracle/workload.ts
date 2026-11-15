import { finite, isObject } from '../json.js';

/** What a chatbot is asked to do in a month: chats a day, the tokens of each chat, and the days. */
export interface Workload {
  chatsPerDay: number;
  inputTokens: number;
  outputTokens: number;
  days: number;
}

const FIELDS = ['chatsPerDay', 'inputTokens', 'outputTokens', 'days'] as const;

/** A workload, or `undefined` when the value is not an object of exactly the four counts, each a finite number from 0. */
export const parseWorkload = (value: unknown): Workload | undefined => {
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length) return undefined;
  const counts = FIELDS.map((field) => value[field]);
  if (!counts.every((count) => finite(count) && count >= 0)) return undefined;
  const [chatsPerDay, inputTokens, outputTokens, days] = counts as number[];
  return {
    chatsPerDay: chatsPerDay as number,
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    days: days as number,
  };
};

const PER_MILLION = 1_000_000;

/**
 * The cost in USD of a workload on a model, from its prices in USD per million
 * tokens: the tokens of the month, input and output, at their prices.
 */
export const workloadCost = (
  workload: Workload,
  inputPrice: number,
  outputPrice: number,
): number =>
  (workload.chatsPerDay *
    workload.days *
    (workload.inputTokens * inputPrice + workload.outputTokens * outputPrice)) /
  PER_MILLION;
