import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { collectGarbage } from './gc.js';

it('frees an object that nothing holds', async () => {
  const weak = (() => new WeakRef({ held: false }))();
  // A WeakRef target lives until the end of the job that made it.
  await sleep(0);
  for (let i = 0; i < 3; i++) {
    collectGarbage();
  }
  expect(weak.deref()).toBeUndefined();
});

it('keeps an object that something holds', async () => {
  const held = { held: true };
  const weak = new WeakRef(held);
  await sleep(0);
  collectGarbage();
  expect(weak.deref()).toBe(held);
});
