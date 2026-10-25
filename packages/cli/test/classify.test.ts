import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.js';
import {
  ApiError,
  ConfigError,
  LimitError,
  TimeoutError,
  UsageError,
} from '../src/errors.js';
import { IdleTimeout, toApiError } from '../src/failures.js';

describe('classify', () => {
  it.each([
    ['a usage error', new UsageError('No question.'), 'USAGE_ERROR', 1],
    ['a config error', new ConfigError('No key.'), 'CONFIG_ERROR', 1],
    ['an API error', new ApiError('API error 401: no.'), 'API_ERROR', 2],
    ['a timeout', new TimeoutError('Timed out.'), 'TIMEOUT', 2],
    ['a limit error', new LimitError('Too many rounds.'), 'LIMIT_EXCEEDED', 3],
  ])(
    'maps %s to its code and exit code, keeping its message',
    (_name, error, code, exit) => {
      expect(classify(error)).toEqual({ code, exit, message: error.message });
    },
  );

  it('maps an idle timeout of the stream to TIMEOUT', () => {
    const error = toApiError(new IdleTimeout(), 60_000);
    expect(classify(error)).toMatchObject({ code: 'TIMEOUT', exit: 2 });
  });

  it('keeps a timeout an API error', () => {
    expect(new TimeoutError('x')).toBeInstanceOf(ApiError);
  });

  const UNEXPECTED =
    'Something went wrong inside ask-openrouter. Try again. If it keeps happening, report it at https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues, with the output of --verbose.';

  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a string', 'boom', 'boom'],
    [
      'a value that cannot become text',
      { toString: 0 },
      'a value that cannot be shown',
    ],
  ])(
    'maps %s to UNEXPECTED_ERROR with exit 2, a fixed message and the reason as detail',
    (_name, error, detail) => {
      expect(classify(error)).toEqual({
        code: 'UNEXPECTED_ERROR',
        exit: 2,
        message: UNEXPECTED,
        detail,
      });
    },
  );

  it('keeps what was thrown out of the message, for any thrown value', () => {
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        expect(classify(thrown).message).toBe(UNEXPECTED);
      }),
    );
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (reason) => {
        const failure = classify(new Error(reason));
        expect(failure.message).toBe(UNEXPECTED);
        expect(failure.detail).toBe(reason);
      }),
    );
  });

  it('gives a code of capital letters and underscores and an exit code of 1 to 3, for any thrown value', () => {
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        const { code, exit } = classify(thrown);
        expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
        expect([1, 2, 3]).toContain(exit);
      }),
    );
  });
});
