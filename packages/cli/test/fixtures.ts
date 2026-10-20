import { readFileSync } from 'node:fs';

// Recorded once from the live API with nock's recorder: response bodies only,
// no headers, no cookies, no key. See design.md ("Calling OpenRouter").
const load = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  );

export const recordedCompletion = load('chat-completion.200.json');
export const recordedUnauthorized = load('unauthorized.401.json');

interface Recorded {
  model: string;
  choices: { message: { content: string } }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
const recorded = recordedCompletion as unknown as Recorded;

export const RECORDED_ANSWER = recorded.choices[0]?.message.content ?? '';
export const RECORDED_MODEL = recorded.model;
export const RECORDED_USAGE = {
  promptTokens: recorded.usage.prompt_tokens,
  completionTokens: recorded.usage.completion_tokens,
  totalTokens: recorded.usage.total_tokens,
};
export const RECORDED_401_MESSAGE = (
  recordedUnauthorized as { error: { message: string } }
).error.message;
