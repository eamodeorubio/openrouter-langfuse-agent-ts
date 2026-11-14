import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface JevRequest {
  url: string;
  authorization?: string;
  body: { state?: string; model?: string; questions?: unknown };
}

/**
 * A stand-in for Jev on the loopback interface. It records every request and
 * answers a Noul question with `noul`, or with `status` and an error body.
 */
export const serveJev = async (
  options: {
    noul?: number | (() => number);
    status?: number;
    body?: string;
  } = {},
) => {
  const requests: JevRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body: JSON.parse(raw || '{}'),
      });
      const status = options.status ?? 200;
      res.writeHead(status, { 'content-type': 'application/json' });
      const noul =
        typeof options.noul === 'function'
          ? options.noul()
          : (options.noul ?? 0.62);
      res.end(
        options.body ??
          (status === 200
            ? JSON.stringify({
                answers: { grade: { noul } },
                model: 'typesafe/jev-1.14',
              })
            : '{"error":"boom"}'),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
