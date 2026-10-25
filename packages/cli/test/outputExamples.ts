const usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };
const success = {
  question: 'q',
  answer: 'a',
  success: true,
  model: 'x/y',
  usage,
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
    { question: 'q', success: true, model: 'x/y', usage },
    false,
  ],
  [
    'a success object without a model',
    { question: 'q', answer: 'a', success: true, usage },
    false,
  ],
  [
    'a success object without usage',
    { question: 'q', answer: 'a', success: true, model: 'x/y' },
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
