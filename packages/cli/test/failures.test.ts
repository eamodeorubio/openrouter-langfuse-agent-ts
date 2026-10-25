import {
  OpenRouterError,
  RequestTimeoutError,
} from '@openrouter/sdk/models/errors';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TimeoutError } from '../src/errors.js';
import {
  ChunkError,
  IdleTimeout,
  StreamError,
  toApiError,
} from '../src/failures.js';
import { oneLine } from '../src/text.js';

const failed = (status: number, message: string, body = message) =>
  new OpenRouterError(message, {
    response: new Response(body, { status }),
    request: new Request('http://localhost/'),
    body,
  });

const messageOf = (error: unknown): string =>
  (toApiError(error, 60_000) as Error).message;

const REMEDIES: [number, string][] = [
  [401, ' Check OPENROUTER_API_KEY.'],
  [403, ' Check OPENROUTER_API_KEY.'],
  [402, ' Add credits at https://openrouter.ai/settings/credits.'],
  [
    404,
    ' If the model is unknown, check the slug passed with --model or set in OPENROUTER_MODEL.',
  ],
  [429, ' Wait a moment and try again.'],
  [500, ' OpenRouter is having trouble. Try again later.'],
  [599, ' OpenRouter is having trouble. Try again later.'],
];

describe('toApiError', () => {
  it.each(REMEDIES)(
    'ends the message for status %i with its remedy',
    (status, remedy) => {
      expect(messageOf(failed(status, 'the API says so'))).toBe(
        `API error ${status}: the API says so.${remedy}`,
      );
    },
  );

  it.each(REMEDIES)(
    'does the same for an error inside a stream, status %i',
    (status, remedy) => {
      expect(messageOf(new ChunkError(status, 'the provider says so'))).toBe(
        `API error ${status}: the provider says so.${remedy}`,
      );
    },
  );

  it.each([
    ['a full stop', 'User not found.'],
    ['an exclamation mark', 'Slow down!'],
    ['a question mark', 'Who are you?'],
    ['an ellipsis', 'Cut short…'],
  ])('adds no second full stop when the text ends in %s', (_name, text) => {
    expect(messageOf(failed(401, text))).toBe(
      `API error 401: ${text} Check OPENROUTER_API_KEY.`,
    );
  });

  it('keeps the text of the service whole and adds one full stop only where it ends without one, for any text, long or short', () => {
    const text = fc.oneof(
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 190, maxLength: 260 }),
    );
    fc.assert(
      fc.property(
        text.filter((value) => /\S/.test(value)),
        (value) => {
          const said = oneLine(value);
          const stop = /[.!?…]$/.test(said) ? '' : '.';
          expect(messageOf(failed(401, value))).toBe(
            `API error 401: ${said}${stop} Check OPENROUTER_API_KEY.`,
          );
        },
      ),
    );
  });

  it.each([
    [401, '', 'API error 401: Unauthorized. Check OPENROUTER_API_KEY.'],
    [401, '   ', 'API error 401: Unauthorized. Check OPENROUTER_API_KEY.'],
    [400, '', 'API error 400: Bad Request'],
    [
      599,
      '',
      'API error 599: Unknown error. OpenRouter is having trouble. Try again later.',
    ],
  ])(
    'gives the standard reason when the API sent no message (%i, %j)',
    (status, text, expected) => {
      expect(messageOf(failed(status, text))).toBe(expected);
      expect(messageOf(new ChunkError(status, text))).toBe(expected);
    },
  );

  it('leaves the text alone when there is no remedy to add', () => {
    expect(messageOf(failed(400, 'bad request'))).toBe(
      'API error 400: bad request',
    );
    expect(messageOf(failed(400, 'bad request.'))).toBe(
      'API error 400: bad request.',
    );
  });

  it('puts the remedy on a timeout', () => {
    expect((toApiError(new IdleTimeout(), 200) as Error).message).toBe(
      'Request timed out: no data for 0.2 s. Try again, or choose another model.',
    );
  });

  it('describes a dropped stream in its own words', () => {
    expect(messageOf(new StreamError('terminated: ECONNRESET at undici'))).toBe(
      'The connection to OpenRouter dropped before the answer was complete.',
    );
  });

  it('describes a reply it cannot read in its own words', () => {
    const shape = Object.assign(new Error('[{"code":"invalid_type"}]'), {
      name: 'ZodError',
    });
    expect(messageOf(shape)).toBe(
      'OpenRouter sent a reply this tool could not read. Try again, or choose another model.',
    );
  });

  it('shows the standard reason, not the markup, for a reply that is a web page', () => {
    const html = '<html><body><h1>502 Bad Gateway</h1></body></html>';
    const wrapper = `API error occurred: Status 502 Content-Type text/html. Body: ${html}`;
    expect(messageOf(failed(502, wrapper, html))).toBe(
      'API error 502: Bad Gateway. OpenRouter is having trouble. Try again later.',
    );
  });

  it('shows the API message from a body the library did not unpack', () => {
    const body = '{"error":{"message":"Provider returned error","code":502}}';
    const wrapper = `API error occurred: Status 502 Content-Type application/json. Body: ${body}`;
    expect(messageOf(failed(502, wrapper, body))).toBe(
      'API error 502: Provider returned error. OpenRouter is having trouble. Try again later.',
    );
  });

  it('shows the standard reason when the body is plain text', () => {
    const wrapper =
      'API error occurred: Status 500 Content-Type text/plain. Body: boom';
    expect(messageOf(failed(500, wrapper, 'boom'))).toBe(
      'API error 500: Internal Server Error. OpenRouter is having trouble. Try again later.',
    );
  });

  it.each([
    ['holds no message', '{"error":{"code":502}}'],
    ['holds a message that is not text', '{"error":{"message":42}}'],
    ['holds a blank message', '{"error":{"message":"   "}}'],
    ['holds no error', '{"detail":"x"}'],
    ['is not JSON', '<html></html>'],
  ])('shows the standard reason when a body %s', (_name, body) => {
    const wrapper = `API error occurred: Status 502 Content-Type text/plain. Body: ${body}`;
    expect(messageOf(failed(502, wrapper, body))).toBe(
      'API error 502: Bad Gateway. OpenRouter is having trouble. Try again later.',
    );
  });

  it('adds no remedy to a status above the range of HTTP', () => {
    expect(messageOf(new ChunkError(600, 'odd'))).toBe('API error 600: odd');
  });

  it('says the error is unknown for a status that has no standard reason', () => {
    const wrapper =
      'API error occurred: Status 599 Content-Type text/plain. Body: x';
    expect(messageOf(failed(599, wrapper, 'x'))).toBe(
      'API error 599: Unknown error. OpenRouter is having trouble. Try again later.',
    );
  });

  it('counts a request that timed out as a timeout', () => {
    expect(toApiError(new RequestTimeoutError('x'), 1)).toBeInstanceOf(
      TimeoutError,
    );
  });

  it('says that a request timed out', () => {
    expect(messageOf(new RequestTimeoutError('Request timed out'))).toBe(
      'The request to OpenRouter timed out. Try again, or choose another model.',
    );
  });

  it('keeps any message on one line, for any status and any text', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string(),
        (status, text) => {
          const message = messageOf(failed(status, text, text));
          expect(message).not.toMatch(/[\r\n]/);
          expect(message.startsWith(`API error ${status}: `)).toBe(true);
        },
      ),
    );
  });
});
