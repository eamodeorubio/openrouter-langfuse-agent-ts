import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const MODELS = fs.readFileSync(
  path.join(import.meta.dirname, 'fixtures/models.api.json'),
  'utf8',
);

/** A model list on the loopback interface that answers with `status`. */
export const serveCatalog = async (status = 200) => {
  const server = http.createServer((_, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? MODELS : '{"error":"boom"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1/models`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
