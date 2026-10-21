/** A piece of a tool call as a stream delivers it: `id` and `name` come first, `arguments` in parts. */
export interface ToolCallFragment {
  index: number;
  id?: string | null | undefined;
  function?:
    | {
        name?: string | null | undefined;
        arguments?: string | null | undefined;
      }
    | undefined;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The tool calls a model made, in index order, each joined from its fragments. */
export const joinToolCalls = (fragments: ToolCallFragment[]): ToolCall[] => {
  const calls = new Map<number, ToolCall>();
  for (const { index, id, function: fn } of fragments) {
    const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
    call.id ||= id ?? '';
    call.name ||= fn?.name ?? '';
    call.arguments += fn?.arguments ?? '';
    calls.set(index, call);
  }
  return [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
};

/** A reasoning block, or a piece of one. Only the fields the join touches are named. */
export interface ReasoningDetail {
  type: string;
  index?: number | undefined;
  [field: string]: unknown;
}

/** The fields whose text arrives in pieces. Every other field arrives whole, in one fragment. */
const PIECEWISE = new Set(['text', 'summary', 'data']);

/**
 * The reasoning blocks of a response, each joined from its fragments. A block
 * is told apart by type and index. Text, summary and data are concatenated;
 * any other field takes the last value that is not null (a signature comes in
 * a fragment of its own), and stays null if no fragment gives one. Blocks keep
 * the order in which they first appeared, and nothing is dropped or reworded,
 * because a signed block must go back to the model as it came.
 */
export const joinReasoningDetails = (
  fragments: ReasoningDetail[],
): ReasoningDetail[] => {
  const blocks = new Map<string, ReasoningDetail>();
  for (const fragment of fragments) {
    // Streamed fragments always carry an index (every recorded stream does);
    // a complete response gets one from `chat` before it reaches this join.
    const key = `${fragment.type}:${fragment.index ?? 0}`;
    const block = blocks.get(key) ?? ({} as ReasoningDetail);
    for (const [field, value] of Object.entries(fragment)) {
      if (PIECEWISE.has(field) && typeof value === 'string') {
        block[field] =
          `${typeof block[field] === 'string' ? block[field] : ''}${value}`;
      } else if (value !== null && value !== undefined) {
        block[field] = value;
      } else if (block[field] === undefined) {
        block[field] = value;
      }
    }
    blocks.set(key, block);
  }
  return [...blocks.values()];
};
