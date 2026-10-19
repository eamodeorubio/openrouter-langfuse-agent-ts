import { expect, it } from 'vitest';
import { name } from '../src/index.js';

it('exposes the package name', () => {
  expect(name).toBe('openrouter-langfuse-agent-ts');
});
