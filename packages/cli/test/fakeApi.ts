import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';

export interface Sent {
  method: string;
  /** The path without the query, such as `/api/v1/model/openai/gpt-5`. */
  path: string;
  query: URLSearchParams;
  model: string;
  /** The first user message of a chat request. */
  question: string;
  authorization: string | undefined;
  /** The W3C trace context header, when the request carries one. */
  traceparent: string | undefined;
  /** The parsed JSON body of a chat request; empty for a GET. */
  body: ChatBody;
}

/** The parts of a chat request the tests look at. */
export interface ChatBody {
  model?: string;
  stream?: boolean;
  parallel_tool_calls?: boolean;
  tool_choice?: unknown;
  tools?: { type: string; function: { name: string; parameters?: unknown } }[];
  messages?: Record<string, unknown>[];
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
  /** Queues one response for `GET` of `path` (without the query), such as `/model/openai/gpt-5`. */
  replyGet(path: string, status: number, body: unknown): void;
  /** Like `replyGet`, but the response waits until the returned function is called. */
  holdGet(path: string, status: number, body: unknown): () => void;
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

/** A string body answered with 200 is an event stream; anything else is sent as it is. */
const jsonResponder =
  (status: number, body: unknown): Responder =>
  (response) => {
    if (typeof body === 'string') {
      response.writeHead(status, {
        'content-type': status === 200 ? 'text/event-stream' : 'text/plain',
      });
      response.end(body);
      return;
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

export const startFakeApi = async (): Promise<FakeApi> => {
  let queue: Responder[] = [];
  let getQueues = new Map<string, Responder[]>();
  let dropAll = false;

  const server = await listen(async (request, response) => {
    let body: ChatBody;
    try {
      body = JSON.parse((await readBody(request)) || '{}');
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { code: 400, message: 'body is not JSON' } }),
      );
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';
    const firstUser = body.messages?.find((message) => message.role === 'user');
    api.sent.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      model: body.model ?? '',
      question: typeof firstUser?.content === 'string' ? firstUser.content : '',
      authorization: request.headers.authorization,
      traceparent: request.headers.traceparent as string | undefined,
      body,
    });
    if (dropAll) {
      request.socket.destroy();
      return;
    }
    const respond =
      method === 'GET'
        ? getQueues.get(url.pathname.replace(/^\/api\/v1/, ''))?.shift()
        : queue.shift();
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
      queue.push(jsonResponder(status, body));
    },
    replyGet(path, status, body) {
      const queued = getQueues.get(path) ?? [];
      queued.push(jsonResponder(status, body));
      getQueues.set(path, queued);
    },
    holdGet(path, status, body) {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queued = getQueues.get(path) ?? [];
      queued.push((response) => {
        released.then(() => jsonResponder(status, body)(response));
      });
      getQueues.set(path, queued);
      return release;
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
      getQueues = new Map();
      dropAll = false;
      api.sent = [];
    },
    close: () => server.close(),
  };
  return api;
};
