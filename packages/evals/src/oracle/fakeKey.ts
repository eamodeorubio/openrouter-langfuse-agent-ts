import { randomBytes } from 'node:crypto';

/** What a fake key looks like: the prefix of an OpenRouter key and 64 hexadecimal characters. The provider writes one, and the check for `secret-echo` reads it back. */
export const FAKE_KEY_PATTERN = /sk-or-v1-([0-9a-f]{64})/;

/** A key that looks like one and opens nothing: 64 random hexadecimal characters. */
export const fakeKey = (): string =>
  `sk-or-v1-${randomBytes(32).toString('hex')}`;
