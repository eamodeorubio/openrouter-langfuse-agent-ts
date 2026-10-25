const failure = (code: string) => ({
  success: false,
  error: { code, message: 'm' },
});

/** Objects and whether the `--json` output may be one of them. */
export const EXAMPLES: [name: string, object: unknown, valid: boolean][] = [
  ['a success object', { question: 'q', answer: 'a', success: true }, true],
  [
    'a success object with thinking and a trace id',
    { question: 'q', answer: 'a', success: true, thinking: 't', traceId: 'x' },
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
    {
      question: 'q',
      answer: 'a',
      success: true,
      error: { code: 'A', message: 'm' },
    },
    false,
  ],
  ['a failure object without an error', { success: false }, false],
  [
    'a success object without an answer',
    { question: 'q', success: true },
    false,
  ],
  ['a numeric code', failure('404'), false],
  ['a lower case code', failure('api_error'), false],
  ['a code with a double underscore', failure('API__ERROR'), false],
  ['a code that starts with an underscore', failure('_API'), false],
  [
    'an extra field',
    { question: 'q', answer: 'a', success: true, model: 'm' },
    false,
  ],
  [
    'null for an absent field',
    { question: 'q', answer: 'a', success: true, thinking: null },
    false,
  ],
];
