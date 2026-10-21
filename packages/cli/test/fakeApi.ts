import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';

export interface Sent {
  model: string;
  question: string;
  authorization: string | undefined;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface Listening {
  /** The base URL to give the client. */
  url: string;
  close(): Promise<void>;
}

/** Starts a server on a free loopback port. The one place that listens and closes. */
export const listen = async (handler: Handler): Promise<Listening> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
};

/** Runs a server the test controls completely, for tests that hold a connection open or cut it. */
export const withServer = async (
  handler: Handler,
  test: (serverURL: string) => Promise<void>,
) => {
  const server = await listen(handler);
  try {
    await test(server.url);
  } finally {
    await server.close();
  }
};

type Responder = (response: ServerResponse) => void;

/**
 * A stand-in for the OpenRouter API on a real loopback socket. It answers the
 * queued responses in order and records what it was asked. Real sockets let
 * the tests cancel, cut off and stall streams the way production does, which
 * `nock`'s mock sockets cannot survive.
 */
export interface FakeApi {
  /** The base URL to give the client. */
  url: string;
  sent: Sent[];
  /** Queues one response. A string body answered with 200 is an event stream; anything else is sent as it is. */
  reply(status: number, body: unknown): void;
  /** Queues the same response `times` times, enough to outlast the retries. */
  replyTimes(times: number, status: number, body: unknown): void;
  /** Queues a streamed response whose body the test feeds by hand. Destroying it drops the connection. */
  open(): PassThrough;
  /** Makes every request lose its connection. */
  networkError(): void;
  /** Forgets the queue and what was sent. */
  reset(): void;
  close(): Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
};

export const startFakeApi = async (): Promise<FakeApi> => {
  let queue: Responder[] = [];
  let dropAll = false;

  const server = await listen(async (request, response) => {
    let body: { model?: string; messages?: { content?: string }[] };
    try {
      body = JSON.parse((await readBody(request)) || '{}');
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { code: 400, message: 'body is not JSON' } }),
      );
      return;
    }
    api.sent.push({
      model: body.model ?? '',
      question: body.messages?.[0]?.content ?? '',
      authorization: request.headers.authorization,
    });
    if (dropAll) {
      request.socket.destroy();
      return;
    }
    const respond = queue.shift();
    if (!respond) {
      response.writeHead(501, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { code: 501, message: 'no response queued' } }),
      );
      return;
    }
    respond(response);
  });

  const api: FakeApi = {
    url: server.url,
    sent: [],
    reply(status, body) {
      queue.push((response) => {
        if (typeof body === 'string') {
          response.writeHead(status, {
            'content-type': status === 200 ? 'text/event-stream' : 'text/plain',
          });
          response.end(body);
          return;
        }
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      });
    },
    replyTimes(times, status, body) {
      for (let i = 0; i < times; i++) {
        api.reply(status, body);
      }
    },
    open() {
      const pass = new PassThrough();
      queue.push((response) => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        pass.pipe(response);
        pass.on('error', () => response.destroy());
        // Held open until the test ends or destroys it.
        pass.on('close', () => {
          if (pass.errored) {
            response.destroy();
          }
        });
      });
      return pass;
    },
    networkError() {
      dropAll = true;
    },
    reset() {
      queue = [];
      dropAll = false;
      api.sent = [];
    },
    close: () => server.close(),
  };
  return api;
};
