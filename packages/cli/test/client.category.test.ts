import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFromApi, withSignal } from '../src/client.js';

afterEach(() => vi.restoreAllMocks());

const MODELS = 'https://openrouter.ai/api/v1/models';

/** The request that reaches `fetch` when the fetcher gets one for `url`. */
const sent = async (url: string, init?: RequestInit): Promise<Request> => {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}'));
  await fetchFromApi(new Request(url, init));
  const [input] = spy.mock.calls.at(-1) as [Request];
  spy.mockRestore();
  return input;
};

describe('a models request with a category', () => {
  it('goes out without limit and offset, with everything else as it was', async () => {
    const request = await sent(
      `${MODELS}?category=marketing%2Fseo&limit=500&sort=newest&offset=0&q=a+b`,
      { headers: { authorization: 'Bearer placeholder' } },
    );
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(MODELS);
    expect([...url.searchParams]).toEqual([
      ['category', 'marketing/seo'],
      ['sort', 'newest'],
      ['q', 'a b'],
    ]);
    expect(request.method).toBe('GET');
    expect(request.headers.get('authorization')).toBe('Bearer placeholder');
  });

  it('keeps the signal of the context it runs in', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}'));
    const controller = new AbortController();
    await withSignal(controller.signal, () =>
      fetchFromApi(new Request(`${MODELS}?category=legal&limit=1`)),
    );
    expect(spy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it.each([
    [`${MODELS}?limit=500&offset=0`],
    [`${MODELS}?limit=5&offset=5&supported_parameters=tools`],
    ['https://openrouter.ai/api/v1/model/a/b?category=legal&limit=1'],
  ])('leaves %s untouched', async (url) => {
    expect((await sent(url)).url).toBe(url);
  });

  it('never carries limit or offset, and keeps every other parameter in order', async () => {
    const pair = fc.tuple(
      fc.oneof(
        fc.constantFrom('limit', 'offset', 'sort', 'q'),
        fc.string({ minLength: 1 }),
      ),
      fc.string(),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(pair, { maxLength: 6 }), async (pairs) => {
        const query = new URLSearchParams([['category', 'legal'], ...pairs]);
        const request = await sent(`${MODELS}?${query}`);
        expect([...new URL(request.url).searchParams]).toEqual(
          [...query].filter(([name]) => name !== 'limit' && name !== 'offset'),
        );
      }),
    );
  });
});
