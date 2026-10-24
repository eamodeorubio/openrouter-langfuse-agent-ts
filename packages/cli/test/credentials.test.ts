import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { checkCredentials } from '../src/tracing/credentials.js';
import { withServer } from './fakeApi.js';

const keys = { publicKey: 'pk-lf-AAA', secretKey: 'sk-lf-BBB' };
const basic = `Basic ${Buffer.from('pk-lf-AAA:sk-lf-BBB').toString('base64')}`;

/** Runs `check` against a real Langfuse stand-in that answers with `handler`. */
const against = <T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  check: (baseUrl: string) => Promise<T>,
) =>
  withServer(handler, (serverURL) =>
    check(serverURL.replace(/\/api\/v1$/, '')).then(() => undefined),
  );

const answering =
  (status: number, body = '') =>
  (_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(body);
  };

const messageOf = async (check: Promise<void>): Promise<string> => {
  try {
    await check;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as Error).message;
  }
  throw new Error('the check did not fail');
};

describe('checkCredentials', () => {
  it('asks the projects endpoint with the keys as Basic auth', async () => {
    const seen: string[] = [];
    await against(
      (request, response) => {
        seen.push(
          `${request.method} ${request.url} ${request.headers.authorization}`,
        );
        answering(200, '{"data":[]}')(request, response);
      },
      (baseUrl) => checkCredentials({ ...keys, baseUrl }),
    );
    expect(seen).toEqual([`GET /api/public/projects ${basic}`]);
  });

  it('asks under the path of a base URL that has one', async () => {
    const seen: string[] = [];
    await against(
      (request, response) => {
        seen.push(request.url ?? '');
        answering(200)(request, response);
      },
      (baseUrl) =>
        checkCredentials({ ...keys, baseUrl: `${baseUrl}/langfuse` }),
    );
    expect(seen).toEqual(['/langfuse/api/public/projects']);
  });

  it.each([401, 403])('says the keys are rejected on %i', async (status) => {
    await against(answering(status), async (baseUrl) => {
      const message = await messageOf(checkCredentials({ ...keys, baseUrl }));
      expect(message).toMatch(/rejected/);
      expect(message).toMatch(/LANGFUSE_PUBLIC_KEY/);
      expect(message).toMatch(/LANGFUSE_SECRET_KEY/);
    });
  });

  it('says only the status for any other failure, not that the keys were rejected', async () => {
    await against(answering(503, 'unavailable'), async (baseUrl) => {
      expect(await messageOf(checkCredentials({ ...keys, baseUrl }))).toBe(
        `Langfuse at ${baseUrl} answered HTTP 503.`,
      );
    });
  });

  it('accepts an answer that has no body', async () => {
    await against(answering(204), (baseUrl) =>
      checkCredentials({ ...keys, baseUrl }),
    );
  });

  it('does not follow a redirect and reports its status', async () => {
    await against(
      (_request, response) => {
        response.writeHead(302, { location: 'http://elsewhere.invalid/' });
        response.end();
      },
      async (baseUrl) => {
        expect(await messageOf(checkCredentials({ ...keys, baseUrl }))).toMatch(
          /302/,
        );
      },
    );
  });

  it('names the base URL when the connection fails', async () => {
    expect(
      await messageOf(
        checkCredentials({ ...keys, baseUrl: 'http://127.0.0.1:1' }),
      ),
    ).toBe('Cannot reach Langfuse at http://127.0.0.1:1.');
  });

  it('names the base URL when Langfuse does not answer in time', async () => {
    await against(
      () => {},
      async (baseUrl) => {
        const message = await messageOf(
          checkCredentials({ ...keys, baseUrl }, 50),
        );
        expect(message).toBe(
          `Langfuse at ${baseUrl} did not answer within 0.05 s.`,
        );
      },
    );
  });

  it.each([401, 500])(
    'never writes a key when Langfuse answers %i',
    async (status) => {
      await against(answering(status), async (baseUrl) => {
        const message = await messageOf(checkCredentials({ ...keys, baseUrl }));
        for (const secret of ['pk-lf-AAA', 'sk-lf-BBB']) {
          expect(message).not.toContain(secret);
        }
      });
    },
  );
});
