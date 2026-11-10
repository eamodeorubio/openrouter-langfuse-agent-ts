const usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };
const entry = {
  round: 1,
  name: 'calculate',
  arguments: '{"expression":"1+1"}',
  output: '{"formula":"1+1","result":"2"}',
  failed: false,
};
const success = {
  question: 'q',
  answer: 'a',
  success: true,
  model: 'x/y',
  usage,
  toolCalls: [],
  args: { verbose: false },
};

const failure = (code: string) => ({
  success: false,
  error: { code, message: 'm' },
});

/** Objects and whether the `--json` output may be one of them. */
export const EXAMPLES: [name: string, object: unknown, valid: boolean][] = [
  ['a success object', success, true],
  [
    'a success object with thinking and a trace id',
    { ...success, thinking: 't', traceId: 'x' },
    true,
  ],
  [
    'a success object with every optional usage field',
    {
      ...success,
      usage: { ...usage, reasoningTokens: 0, cachedTokens: 7, cost: 0.003 },
    },
    true,
  ],
  ['a failure object', failure('API_ERROR'), true],
  [
    'a failure object with everything known',
    {
      question: 'q',
      answer: 'a',
      success: false,
      thinking: 't',
      traceId: 'x',
      error: { code: 'TIMEOUT', message: 'm' },
    },
    true,
  ],
  [
    'a success object with an error',
    { ...success, error: { code: 'A', message: 'm' } },
    false,
  ],
  ['a failure object without an error', { success: false }, false],
  [
    'a success object without an answer',
    { ...success, answer: undefined },
    false,
  ],
  ['a success object without a model', { ...success, model: undefined }, false],
  ['a success object without usage', { ...success, usage: undefined }, false],
  [
    'a success object without toolCalls',
    { ...success, toolCalls: undefined },
    false,
  ],
  ['a success object without args', { ...success, args: undefined }, false],
  [
    'a success object with tool calls, a failed one among them',
    {
      ...success,
      toolCalls: [
        entry,
        { ...entry, round: 2, output: '{"error":"bad"}', failed: true },
      ],
    },
    true,
  ],
  [
    'a success object with every optional argument',
    {
      ...success,
      args: { verbose: true, thinking: false, model: 'x/y' },
    },
    true,
  ],
  [
    'a failure object with tool calls and args',
    {
      ...failure('LIMIT_EXCEEDED'),
      toolCalls: [entry],
      args: { verbose: false },
    },
    true,
  ],
  [
    'a tool call without a field',
    { ...success, toolCalls: [{ ...entry, output: undefined }] },
    false,
  ],
  [
    'a tool call with an extra field',
    { ...success, toolCalls: [{ ...entry, truncated: false }] },
    false,
  ],
  [
    'a tool call with round 0',
    { ...success, toolCalls: [{ ...entry, round: 0 }] },
    false,
  ],
  [
    'a tool call with a fractional round',
    { ...success, toolCalls: [{ ...entry, round: 1.5 }] },
    false,
  ],
  [
    'a tool call whose failed is not a boolean',
    { ...success, toolCalls: [{ ...entry, failed: 'no' }] },
    false,
  ],
  ['args without verbose', { ...success, args: { thinking: true } }, false],
  [
    'args with a thinking that is not a boolean',
    { ...success, args: { verbose: false, thinking: 'yes' } },
    false,
  ],
  [
    'args with a field that is not in the table',
    { ...success, args: { verbose: false, json: true } },
    false,
  ],
  [
    'usage without the total',
    { ...success, usage: { promptTokens: 1, completionTokens: 2 } },
    false,
  ],
  [
    'usage with an extra field',
    { ...success, usage: { ...usage, price: 1 } },
    false,
  ],
  [
    'a negative count',
    { ...success, usage: { ...usage, promptTokens: -1 } },
    false,
  ],
  [
    'a fractional count',
    { ...success, usage: { ...usage, totalTokens: 1.5 } },
    false,
  ],
  ['a negative cost', { ...success, usage: { ...usage, cost: -1 } }, false],
  [
    'a failure object with a model',
    { ...failure('API_ERROR'), model: 'x/y' },
    false,
  ],
  ['a failure object with usage', { ...failure('API_ERROR'), usage }, false],
  ['a numeric code', failure('404'), false],
  ['a lower case code', failure('api_error'), false],
  ['a code with a double underscore', failure('API__ERROR'), false],
  ['a code that starts with an underscore', failure('_API'), false],
  ['an extra field', { ...success, extra: 'm' }, false],
  ['null for an absent field', { ...success, thinking: null }, false],
];
