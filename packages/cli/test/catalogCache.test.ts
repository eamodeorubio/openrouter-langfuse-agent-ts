import { describe, expect, it, vi } from 'vitest';
import {
  type CatalogModel,
  createCatalogCache,
} from '../src/tools/catalogCache.js';

const found = { ok: true as const, value: [] as CatalogModel[] };

describe('the catalog cache', () => {
  it('runs the fetch once for a key, however many calls ask, even before the first ends', async () => {
    const cache = createCatalogCache();
    const fetch = vi.fn(async () => found);
    const results = await Promise.all([
      cache.read('k', fetch),
      cache.read('k', fetch),
    ]);
    expect(results[1]).toBe(results[0]);
    expect(await cache.read('k', fetch)).toBe(results[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps one value for each key', async () => {
    const cache = createCatalogCache();
    const fetch = vi.fn(async () => found);
    await cache.read('k1', fetch);
    await cache.read('k2', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('drops a fetch that ended in an error result, so the next call fetches again', async () => {
    const cache = createCatalogCache();
    const failing = vi.fn(async () => ({ ok: false as const, message: 'x' }));
    await cache.read('k', failing);
    await cache.read('k', failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('drops a fetch that threw, hands the error to the caller, and fetches again', async () => {
    const cache = createCatalogCache();
    const boom = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.read('k', boom)).rejects.toThrow('boom');
    const fetch = vi.fn(async () => found);
    expect(await cache.read('k', fetch)).toBe(found);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
