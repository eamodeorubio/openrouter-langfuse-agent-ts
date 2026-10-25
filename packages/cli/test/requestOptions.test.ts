import { describe, expect, it } from 'vitest';
import { requestOptions } from '../src/tools/types.js';

describe('requestOptions', () => {
  it('gives the timeout alone when there is no trace context', () => {
    expect(requestOptions({ client: {} as never, timeoutMs: 5000 })).toEqual({
      timeoutMs: 5000,
    });
  });

  it('adds the traceparent header when there is one', () => {
    expect(
      requestOptions({
        client: {} as never,
        timeoutMs: 5000,
        traceparent: '00-a-b-01',
      }),
    ).toEqual({ timeoutMs: 5000, headers: { traceparent: '00-a-b-01' } });
  });
});
