import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, fetchWithSignal, withSignal } from '../src/client.js';

afterEach(() => vi.restoreAllMocks());

/** The signal that `fetch` was given in call number `index`, or `undefined` when it got none. */
const signalOf = (spy: ReturnType<typeof vi.spyOn>, index = 0) =>
  (spy.mock.calls[index] as [unknown, RequestInit | undefined])[1]?.signal;

const stubFetch = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}'));

describe('fetchWithSignal', () => {
  it('gives fetch the signal of the context it runs in', async () => {
    const spy = stubFetch();
    const controller = new AbortController();
    const request = new Request('http://localhost/');
    await withSignal(controller.signal, () => fetchWithSignal(request));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(request);
    expect(signalOf(spy)).toBe(controller.signal);
  });

  it('still has the signal after the work has waited', async () => {
    const spy = stubFetch();
    const controller = new AbortController();
    await withSignal(controller.signal, async () => {
      await sleep(5);
      await fetchWithSignal(new Request('http://localhost/'));
    });
    expect(signalOf(spy)).toBe(controller.signal);
  });

  it('gives fetch nothing extra outside any context, so the request keeps its own signal', async () => {
    const spy = stubFetch();
    await fetchWithSignal(new Request('http://localhost/'));
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('gives a request made after the context has ended nothing, as a tool lookup is', async () => {
    const spy = stubFetch();
    const controller = new AbortController();
    await withSignal(controller.signal, async () => {
      await sleep(1);
    });
    await fetchWithSignal(new Request('http://localhost/'));
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('reaches fetch through the SDK client, across all its awaits', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const controller = new AbortController();
    const client = createClient('key', 'http://localhost:1');
    await withSignal(controller.signal, () =>
      client.chat.send(
        {
          chatRequest: {
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
          },
        },
        { signal: controller.signal },
      ),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(signalOf(spy)).toBe(controller.signal);
  });

  it('keeps what else the caller passed to fetch', async () => {
    const spy = stubFetch();
    const controller = new AbortController();
    await withSignal(controller.signal, () =>
      fetchWithSignal('http://localhost/', { method: 'POST' }),
    );
    expect(spy.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      signal: controller.signal,
    });
  });

  it('lets no context see the signal of another, however the requests interleave', async () => {
    const spy = stubFetch();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 4 }), {
          minLength: 2,
          maxLength: 6,
        }),
        async (delays) => {
          spy.mockClear();
          const controllers = delays.map(() => new AbortController());
          const requests = delays.map(
            (_, i) => new Request(`http://localhost/${i}`),
          );
          await Promise.all(
            delays.map((delay, i) =>
              withSignal(
                (controllers[i] as AbortController).signal,
                async () => {
                  await sleep(delay);
                  await fetchWithSignal(requests[i] as Request);
                },
              ),
            ),
          );
          for (const [call, args] of spy.mock.calls.entries()) {
            const index = requests.indexOf(args[0] as Request);
            expect(index, `call ${call}`).toBeGreaterThanOrEqual(0);
            expect(signalOf(spy, call)).toBe(controllers[index]?.signal);
          }
          expect(spy).toHaveBeenCalledTimes(delays.length);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('ends a request that is waiting for a server when the signal aborts', async () => {
    const server = createServer(() => {
      // Accepts the request and never answers.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const controller = new AbortController();
      const pending = withSignal(controller.signal, () =>
        fetchWithSignal(new Request(`http://127.0.0.1:${port}/`)),
      );
      await sleep(30);
      controller.abort();
      await expect(pending).rejects.toThrow(/abort/i);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
