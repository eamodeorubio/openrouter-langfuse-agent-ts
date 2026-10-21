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

// A streamed response recorded the same way: an SSE body with thinking chunks,
// answer chunks, a usage chunk and the final `[DONE]` line.
export const recordedStream = readFileSync(
  new URL('./fixtures/chat-completion.stream.sse', import.meta.url),
  'utf8',
);

export const DONE = 'data: [DONE]\n\n';

/**
 * The body to hand to `nock`. After `[DONE]` the SDK cancels the rest of the
 * response, and cancelling a `nock` mock socket makes undici throw an
 * uncaught TypeError a moment later. The stream ends the same way without
 * the line, so mocks leave it out. Real sockets and the local server keep it.
 */
export const forNock = (body: string): string =>
  body.endsWith(DONE) ? body.slice(0, -DONE.length) : body;

/** The events of an SSE body, each ending with its blank line, `[DONE]` included. */
export const sseEvents = (body: string): string[] =>
  body
    .split('\n\n')
    .filter(Boolean)
    .map((event) => `${event}\n\n`);

export const sseEvent = (chunk: object): string =>
  `data: ${JSON.stringify(chunk)}\n\n`;

interface Delta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_details?: object[];
}

/** A streamed chunk shaped like the recorded ones. */
export const streamChunk = (
  delta: Delta,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'gen-test',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'test/model',
  provider: 'Test',
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

export const contentChunk = (text: string) => streamChunk({ content: text });

export const thinkingChunk = (text: string) =>
  streamChunk({
    content: '',
    reasoning: text,
    reasoning_details: [
      { type: 'reasoning.text', text, format: 'unknown', index: 0 },
    ],
  });

/** The chunk that carries only usage, as the live API sends it after the last answer chunk. */
export const usageChunk = (
  usage: Record<string, unknown> = {
    prompt_tokens: 12,
    completion_tokens: 34,
    total_tokens: 46,
  },
) => streamChunk({ content: '' }, { usage });

/** A chunk with an empty `choices` list that carries only usage, as OpenAI-style APIs send it. */
export const usageOnlyChunk = (
  usage: Record<string, unknown> = {
    prompt_tokens: 12,
    completion_tokens: 34,
    total_tokens: 46,
  },
) => streamChunk({}, { choices: [], usage });

/** An error chunk, as a provider sends one mid-stream. */
export const errorChunk = (code: number, message: string) =>
  streamChunk(
    {},
    {
      choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
      error: { code, message },
    },
  );

/** An SSE body made of the given chunks, closed with `[DONE]`. */
export const sseBody = (...chunks: object[]): string =>
  `${chunks.map(sseEvent).join('')}${DONE}`;

/** The recorded stream cut off in the middle of an event, as a dropped connection leaves it. */
export const truncatedStream = (events = 3): string => {
  const kept = sseEvents(recordedStream).slice(0, events).join('');
  return `${kept}data: {"id":"gen-cut","object":"chat.completion.ch`;
};

interface RecordedChunk {
  model: string;
  choices: { delta: { content?: string | null; reasoning?: string | null } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

const recordedChunks = sseEvents(recordedStream)
  .map((event) => event.replace(/^data: /, '').trim())
  .filter((data) => data !== '[DONE]')
  .map((data) => JSON.parse(data) as RecordedChunk);

const joined = (pick: (chunk: RecordedChunk) => string | null | undefined) =>
  recordedChunks.map((chunk) => pick(chunk) ?? '').join('');

export const RECORDED_STREAM_ANSWER = joined(
  (chunk) => chunk.choices[0]?.delta.content,
);
export const RECORDED_STREAM_THINKING = joined(
  (chunk) => chunk.choices[0]?.delta.reasoning,
);
export const RECORDED_STREAM_MODEL = recordedChunks[0]?.model ?? '';
const streamUsage = recordedChunks.find((chunk) => chunk.usage)?.usage;
export const RECORDED_STREAM_USAGE = {
  promptTokens: streamUsage?.prompt_tokens ?? 0,
  completionTokens: streamUsage?.completion_tokens ?? 0,
  totalTokens: streamUsage?.total_tokens ?? 0,
  reasoningTokens:
    streamUsage?.completion_tokens_details?.reasoning_tokens ?? 0,
};
