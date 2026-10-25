export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens the model spent thinking, when the provider reports them. */
  reasoningTokens?: number | undefined;
  /** Prompt tokens the provider served from its cache. */
  cachedTokens?: number | undefined;
  /** What the request cost, in US dollars, when the API says. */
  cost?: number | undefined;
}

/** What the stream reports once it has ended: the model that served it and the tokens it used. */
export interface Completion {
  model: string;
  usage: Usage;
}

/** One step of an answer as it arrives. */
export type AskEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'content'; text: string }
  /** The model called a tool; `arguments` is the JSON text it sent. */
  | { kind: 'tool'; name: string; arguments: string }
  /** The run is traced, under this trace id. */
  | { kind: 'trace'; id: string }
  | ({ kind: 'done' } & Completion);

/** Somewhere to write text, such as `process.stdout`. `isTTY` says whether a person is watching it. */
export interface Sink {
  write(text: string): unknown;
  isTTY?: boolean | undefined;
}
