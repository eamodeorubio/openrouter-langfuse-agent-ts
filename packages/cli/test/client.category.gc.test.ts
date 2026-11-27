import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { fetchFromApi } from '../src/client.js';
import { withServer } from './fakeApi.js';
import { collectGarbage } from './gc.js';

describe('a request the server never answers', () => {
  it.each([
    ['without a category', '/models'],
    ['with a category', '/models?category=legal&limit=1'],
  ])(
    'is still ended by its own signal %s, after a garbage collection',
    async (_, path) => {
      let arrived = () => {};
      const waiting = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      await withServer(
        () => arrived(),
        async (serverURL) => {
          const controller = new AbortController();
          // Held to the end, as the SDK holds the request it made.
          const own = new Request(`${serverURL}${path}`, {
            signal: controller.signal,
          });
          const pending = fetchFromApi(own).then(
            () => 'answered',
            () => 'ended',
          );
          await waiting;
          for (let round = 0; round < 10; round += 1) {
            await sleep(20);
            collectGarbage();
          }
          controller.abort();
          expect(await Promise.race([pending, sleep(2_000, 'hung')])).toBe(
            'ended',
          );
          expect(own.signal.aborted).toBe(true);
        },
      );
    },
    10_000,
  );
});
