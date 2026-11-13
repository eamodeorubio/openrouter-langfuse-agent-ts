import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type CatalogModel,
  fetchSnapshot,
  loadSnapshot,
  perMillion,
  SNAPSHOT_FILE,
  SnapshotError,
  toModels,
  writeSnapshot,
} from '../src/oracle/snapshot.js';

const apiModel = (over: Record<string, unknown> = {}) => ({
  id: 'a/b',
  context_length: 8000,
  pricing: { prompt: '0.000001', completion: '0.000004' },
  supported_parameters: ['tools', 'temperature'],
  architecture: {
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
  },
  ...over,
});

describe('a price in USD per million tokens', () => {
  it.each([
    ['0.000003', 3],
    ['0.0000001', 0.1],
    ['0.00000003', 0.03],
    ['0', 0],
    ['0.0', 0],
    ['1', 1_000_000],
    ['0.0000015', 1.5],
    ['0.00000007', 0.07],
    ['12.5', 12_500_000],
    ['000.000002', 2],
  ])('is the shift of %s, which is %s', (price, expected) => {
    expect(perMillion(price)).toBe(expected);
  });

  it.each([
    ['-1'],
    ['-0.5'],
    ['abc'],
    [''],
    [' 1 '],
    ['1e-6'],
    ['1.2.3'],
    ['.5'],
    ['5.'],
  ])('is null for %j, which is not a non-negative decimal string', (price) => {
    expect(perMillion(price)).toBeNull();
  });

  it.each([[undefined], [null], [3], [{}], [['1']]])(
    'is null for a value that is not text: %j',
    (price) => {
      expect(perMillion(price)).toBeNull();
    },
  );

  it('agrees with a multiplication of the number, up to rounding, for any decimal string', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.stringMatching(/^[0-9]{1,9}$/),
        (whole, fraction) => {
          const text = `${whole}.${fraction}`;
          const viaNumber = Number(text) * 1_000_000;
          const shifted = perMillion(text);
          expect(shifted).not.toBeNull();
          expect(Math.abs((shifted as number) - viaNumber)).toBeLessThanOrEqual(
            1e-6 * Math.max(1, viaNumber),
          );
        },
      ),
    );
  });

  it('never throws, and is a non-negative finite number or null', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = perMillion(value);
        expect(
          result === null || (Number.isFinite(result) && result >= 0),
        ).toBe(true);
      }),
    );
  });
});

describe('the models of the API list', () => {
  it('keep what the queries read, with prices per million tokens', () => {
    expect(toModels({ data: [apiModel()] })).toEqual([
      {
        id: 'a/b',
        contextLength: 8000,
        supportedParameters: ['tools', 'temperature'],
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        inputPrice: 1,
        outputPrice: 4,
      },
    ]);
  });

  it('give a router null prices, as its -1 is not a price', () => {
    const [router] = toModels({
      data: [
        apiModel({
          id: 'openrouter/auto',
          pricing: { prompt: '-1', completion: '-1' },
        }),
      ],
    });
    expect(router).toMatchObject({ inputPrice: null, outputPrice: null });
  });

  it('give null for a missing context, a missing pricing and no parameters', () => {
    const [model] = toModels({
      data: [
        { id: 'x/y', context_length: 'big', supported_parameters: 'tools' },
      ],
    });
    expect(model).toStrictEqual({
      id: 'x/y',
      contextLength: null,
      supportedParameters: [],
      inputModalities: [],
      outputModalities: [],
      inputPrice: null,
      outputPrice: null,
    });
  });

  it('keep the modalities that are text, and none when the architecture says none', () => {
    const [kept] = toModels({
      data: [
        apiModel({
          architecture: {
            input_modalities: ['text', 3, null, 'audio'],
            output_modalities: ['image', {}],
          },
        }),
      ],
    });
    expect(kept).toMatchObject({
      inputModalities: ['text', 'audio'],
      outputModalities: ['image'],
    });
    for (const architecture of [
      undefined,
      null,
      'x',
      {},
      { input_modalities: 'text', output_modalities: 5 },
    ]) {
      const [bare] = toModels({ data: [apiModel({ architecture })] });
      expect(bare).toMatchObject({ inputModalities: [], outputModalities: [] });
    }
  });

  it('keep only the parameters that are text', () => {
    const [model] = toModels({
      data: [apiModel({ supported_parameters: ['tools', 3, null, 'seed'] })],
    });
    expect(model?.supportedParameters).toEqual(['tools', 'seed']);
  });

  it('skip an entry with no id, and an entry that is not an object', () => {
    const models = toModels({
      data: [apiModel(), { name: 'no id' }, 'text', null, apiModel({ id: '' })],
    });
    expect(models.map((m) => m.id)).toEqual(['a/b']);
  });

  it.each([
    ['null', null],
    ['a list', []],
    ['an object with no data', {}],
    ['data that is not a list', { data: {} }],
  ])('refuse %s', (_, body) => {
    expect(() => toModels(body)).toThrow(SnapshotError);
    expect(() => toModels(body)).toThrow(/no list of models/);
  });

  it('never throws on a list, whatever its entries', () => {
    fc.assert(
      fc.property(fc.array(fc.anything()), (data) => {
        expect(Array.isArray(toModels({ data }))).toBe(true);
      }),
    );
  });
});

describe('fetching the snapshot', () => {
  const servers: http.Server[] = [];

  const serve = async (handler: http.RequestListener): Promise<string> => {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/models`;
  };

  afterAll(() => {
    for (const server of servers) server.closeAllConnections();
    for (const server of servers) server.close();
  });

  const answer =
    (status: number, body: string): http.RequestListener =>
    (_, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };

  it('stamps the models with the time they were fetched', async () => {
    const url = await serve(
      answer(200, JSON.stringify({ data: [apiModel()] })),
    );
    const snapshot = await fetchSnapshot(url, {
      now: () => new Date('2026-11-13T22:00:00.000Z'),
    });
    expect(snapshot.fetchedAt).toBe('2026-11-13T22:00:00.000Z');
    expect(snapshot.models.map((m) => m.id)).toEqual(['a/b']);
  });

  it('says the status when the API does not answer 200', async () => {
    const url = await serve(answer(500, '{"error":"boom"}'));
    await expect(fetchSnapshot(url)).rejects.toThrow(
      `Could not fetch the model catalog from ${url}: the API answered 500.`,
    );
  });

  it('says so when the answer is not JSON', async () => {
    const url = await serve(answer(200, '<html>nope</html>'));
    await expect(fetchSnapshot(url)).rejects.toThrow(
      `Could not fetch the model catalog from ${url}: the answer is not JSON.`,
    );
  });

  it('says so when the answer holds no list of models', async () => {
    const url = await serve(answer(200, '{"data":"x"}'));
    await expect(fetchSnapshot(url)).rejects.toThrow(
      /Could not fetch the model catalog from .*: .*no list of models/,
    );
  });

  it('names the address when nothing listens there', async () => {
    const url = 'http://127.0.0.1:9/api/v1/models';
    await expect(fetchSnapshot(url)).rejects.toThrow(
      new RegExp(
        `^Could not fetch the model catalog from ${url.replace(/[./]/g, '\\$&')}: `,
      ),
    );
  });

  it('gives up after the timeout and says so', async () => {
    const url = await serve(() => {
      /* never answers */
    });
    await expect(fetchSnapshot(url, { timeoutMs: 150 })).rejects.toThrow(
      /timed out after 150 ms/,
    );
  });
});

describe('the snapshot file', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-snapshot-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const model: CatalogModel = {
    id: 'a/b',
    contextLength: 1,
    supportedParameters: ['tools'],
    inputModalities: ['text'],
    outputModalities: ['text'],
    inputPrice: 0.5,
    outputPrice: null,
  };

  it('is catalog.json in the directory, and reads back as it was written', () => {
    const dir = tmp();
    const snapshot = { fetchedAt: '2026-11-13T22:00:00.000Z', models: [model] };
    const file = writeSnapshot(dir, snapshot);
    expect(file).toBe(path.join(dir, SNAPSHOT_FILE));
    expect(SNAPSHOT_FILE).toBe('catalog.json');
    expect(loadSnapshot(file)).toEqual(snapshot);
  });

  it('reads back whatever was written', () => {
    const dir = tmp();
    const price = fc.option(fc.double({ min: 0, max: 1e6, noNaN: true }), {
      nil: null,
    });
    const arbitrary = fc.record({
      id: fc.string({ minLength: 1 }),
      contextLength: fc.option(fc.integer({ min: 0, max: 5_000_000 }), {
        nil: null,
      }),
      supportedParameters: fc.array(fc.string()),
      inputModalities: fc.array(fc.string()),
      outputModalities: fc.array(fc.string()),
      inputPrice: price,
      outputPrice: price,
    });
    fc.assert(
      fc.property(fc.array(arbitrary, { maxLength: 6 }), (models) => {
        const snapshot = { fetchedAt: '2026-11-13T22:00:00.000Z', models };
        expect(loadSnapshot(writeSnapshot(dir, snapshot))).toEqual(snapshot);
      }),
      { numRuns: 25 },
    );
  });

  it.each([
    ['not JSON', 'nope'],
    ['no models', '{"fetchedAt":"x"}'],
    ['no fetch time', '{"models":[]}'],
    [
      'a model without an id',
      '{"fetchedAt":"x","models":[{"contextLength":1}]}',
    ],
  ])(
    'is refused with a message that names the file when it holds %s',
    (_, content) => {
      const file = path.join(tmp(), SNAPSHOT_FILE);
      fs.writeFileSync(file, content);
      expect(() => loadSnapshot(file)).toThrow(SnapshotError);
      expect(() => loadSnapshot(file)).toThrow(file);
    },
  );

  it('is refused with a message that names the file when it is missing', () => {
    const file = path.join(tmp(), 'absent.json');
    expect(() => loadSnapshot(file)).toThrow(SnapshotError);
    expect(() => loadSnapshot(file)).toThrow(file);
  });
});

describe('why a fetch failed', () => {
  const failing = (error: unknown): typeof fetch =>
    (async () => {
      throw error;
    }) as unknown as typeof fetch;
  const URL_ = 'http://example.test/models';
  const message = (reason: string) =>
    `Could not fetch the model catalog from ${URL_}: ${reason}`;

  it('is the code of the cause when the request has one', async () => {
    const error = new Error('fetch failed', { cause: { code: 'ECONNRESET' } });
    await expect(
      fetchSnapshot(URL_, { fetch: failing(error) }),
    ).rejects.toThrow(message('ECONNRESET.'));
  });

  it('is the message of the error when it has no cause', async () => {
    await expect(
      fetchSnapshot(URL_, { fetch: failing(new Error('boom')) }),
    ).rejects.toThrow(message('boom.'));
    const noCode = new Error('plain', { cause: 'text' });
    await expect(
      fetchSnapshot(URL_, { fetch: failing(noCode) }),
    ).rejects.toThrow(message('plain.'));
    const numeric = new Error('numeric', { cause: { code: 7 } });
    await expect(
      fetchSnapshot(URL_, { fetch: failing(numeric) }),
    ).rejects.toThrow(message('numeric.'));
  });

  it('is the text of a value that is not an error', async () => {
    await expect(
      fetchSnapshot(URL_, { fetch: failing('refused') }),
    ).rejects.toThrow(message('refused.'));
  });

  it('is the timeout, named with its length, when the request was cut short', async () => {
    const cut = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    await expect(
      fetchSnapshot(URL_, { timeoutMs: 25, fetch: failing(cut) }),
    ).rejects.toThrow(message('timed out after 25 ms.'));
  });

  it('is the timeout too when the body does not arrive in time', async () => {
    const stalled = (async () => ({
      status: 200,
      json: async () => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      },
    })) as unknown as typeof fetch;
    await expect(
      fetchSnapshot(URL_, { timeoutMs: 40, fetch: stalled }),
    ).rejects.toThrow(message('timed out after 40 ms.'));
  });

  it('is a refused connection, named by its code, when nothing listens', async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const url = `http://127.0.0.1:${port}/api/v1/models`;
    await expect(fetchSnapshot(url)).rejects.toThrow(
      `Could not fetch the model catalog from ${url}: ECONNREFUSED.`,
    );
  });
});

describe('a snapshot file that is not a snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-bad-snapshot-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (body: unknown) => {
    const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(
      file,
      typeof body === 'string' ? body : JSON.stringify(body),
    );
    return file;
  };
  const good = {
    id: 'a/b',
    contextLength: 1,
    supportedParameters: ['tools'],
    inputModalities: ['text'],
    outputModalities: ['text'],
    inputPrice: 1,
    outputPrice: 2,
  };
  const snapshot = (model: unknown) => ({ fetchedAt: 'x', models: [model] });

  it.each([
    ['a model that is not an object', 'a/b'],
    ['a model that is null', null],
    ['an id that is not text', { ...good, id: 3 }],
    ['a context that is text', { ...good, contextLength: '1' }],
    ['a context that is missing', { ...good, contextLength: undefined }],
    [
      'parameters that are not a list',
      { ...good, supportedParameters: 'tools' },
    ],
    [
      'a parameter that is not text',
      { ...good, supportedParameters: ['tools', 2] },
    ],
    [
      'input modalities that are not a list',
      { ...good, inputModalities: 'text' },
    ],
    [
      'an input modality that is not text',
      { ...good, inputModalities: ['text', 1] },
    ],
    [
      'output modalities that are missing',
      { ...good, outputModalities: undefined },
    ],
    [
      'an output modality that is not text',
      { ...good, outputModalities: [null] },
    ],
    ['an input price that is text', { ...good, inputPrice: '1' }],
    ['an input price that is missing', { ...good, inputPrice: undefined }],
    ['an output price that is text', { ...good, outputPrice: '2' }],
    ['an output price that is missing', { ...good, outputPrice: undefined }],
  ])('is refused for %s, as not a snapshot', (_, model) => {
    const file = write(snapshot(model));
    expect(() => loadSnapshot(file)).toThrow(
      `The snapshot ${file} is not a snapshot: it needs a fetch time and a list of models with their prices, parameters and modalities. A snapshot taken by an earlier version of the evals lacks the modalities: run the eval again to take a new one.`,
    );
  });

  it('accepts a context and prices that are null, and no parameters', () => {
    const model = {
      ...good,
      contextLength: null,
      supportedParameters: [],
      inputModalities: [],
      outputModalities: [],
      inputPrice: null,
      outputPrice: null,
    };
    expect(loadSnapshot(write(snapshot(model))).models).toEqual([model]);
  });

  it('is refused as unreadable, with the reason, when the file is missing or not JSON', () => {
    const missing = path.join(dir, 'absent.json');
    expect(() => loadSnapshot(missing)).toThrow(
      new RegExp(
        `^The snapshot ${missing.replace(/[./]/g, '\\$&')} cannot be read: .*ENOENT`,
      ),
    );
    const bad = write('nope');
    expect(() => loadSnapshot(bad)).toThrow(
      /^The snapshot .* cannot be read: /,
    );
  });

  it('is refused as not a snapshot when the body is not an object', () => {
    expect(() => loadSnapshot(write('[]'))).toThrow(/is not a snapshot/);
    expect(() => loadSnapshot(write('null'))).toThrow(/is not a snapshot/);
    expect(() => loadSnapshot(write({ fetchedAt: 3, models: [] }))).toThrow(
      /is not a snapshot/,
    );
    expect(() => loadSnapshot(write({ fetchedAt: 'x', models: {} }))).toThrow(
      /is not a snapshot/,
    );
  });
});

describe('every way a fetch fails, as an error of its own', () => {
  const stubFetch = (response: unknown): typeof fetch =>
    (async () => response) as unknown as typeof fetch;
  const URL_ = 'http://example.test/models';

  const failure = async (request: typeof fetch) =>
    fetchSnapshot(URL_, { fetch: request }).catch((error: unknown) => error);

  it.each([
    [
      'a request that did not complete',
      (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
      'down.',
    ],
    [
      'a status that is not 200',
      stubFetch({ status: 503 }),
      'the API answered 503.',
    ],
    [
      'a body that is not JSON',
      stubFetch({
        status: 200,
        json: async () => {
          throw new SyntaxError('bad');
        },
      }),
      'the answer is not JSON.',
    ],
    [
      'a body with no list',
      stubFetch({ status: 200, json: async () => ({ data: 'x' }) }),
      'the answer has no list of models.',
    ],
  ])(
    'is a SnapshotError that names the address and the cause: %s',
    async (_, request, reason) => {
      const error = await failure(request);
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as Error).message).toBe(
        `Could not fetch the model catalog from ${URL_}: ${reason}`,
      );
    },
  );

  it('is not a failure when the answer is a list, even an empty one', async () => {
    const snapshot = await fetchSnapshot(URL_, {
      fetch: stubFetch({ status: 200, json: async () => ({ data: [] }) }),
      now: () => new Date('2026-11-13T22:00:00.000Z'),
    });
    expect(snapshot).toEqual({
      fetchedAt: '2026-11-13T22:00:00.000Z',
      models: [],
    });
  });
});

describe('writing the snapshot where it cannot be written', () => {
  it('is a SnapshotError that names the file and the reason', () => {
    const dir = path.join(os.tmpdir(), 'evals-no-such-dir', 'deeper');
    const file = path.join(dir, SNAPSHOT_FILE);
    expect(() => writeSnapshot(dir, { fetchedAt: 'x', models: [] })).toThrow(
      SnapshotError,
    );
    expect(() => writeSnapshot(dir, { fetchedAt: 'x', models: [] })).toThrow(
      new RegExp(
        `^The snapshot ${file.replace(/[./]/g, '\\$&')} cannot be written: .*ENOENT`,
      ),
    );
  });
});

describe('an answer that is not 200', () => {
  it('has its body cancelled, so that the connection is not left open', async () => {
    let cancelled = false;
    const response = {
      status: 503,
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    };
    const request = (async () => response) as unknown as typeof fetch;
    await expect(
      fetchSnapshot('http://example.test/m', { fetch: request }),
    ).rejects.toThrow(/503/);
    expect(cancelled).toBe(true);
  });
});
