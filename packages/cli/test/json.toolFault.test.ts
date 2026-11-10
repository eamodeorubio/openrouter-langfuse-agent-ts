import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { run } from '../src/cli.js';
import { type FakeApi, startFakeApi } from './fakeApi.js';
import { toolRound } from './fixtures.js';
import { matchesPublishedSchema } from './schema.js';
import { sink } from './sink.js';

// The tools are ones the test controls; the registry's other functions are real.
const behaviors = vi.hoisted(
  () => ({}) as Record<string, () => Promise<unknown> | unknown>,
);

vi.mock('../src/tools/registry.js', async (original) => {
  const { z } = await import('zod');
  const real = await original<typeof import('../src/tools/registry.js')>();
  const tools = ['ok', 'stalled', 'boom'].map((name) => ({
    name,
    description: name,
    parameters: z.object({}).strict(),
    run: async () => ({ ok: true as const, value: await behaviors[name]?.() }),
  }));
  return { ...real, TOOLS: tools };
});

vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

let api: FakeApi;
let dir: string;
beforeAll(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'cli-json-fault-'));
});
afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  api.reset();
  behaviors.ok = () => 'fine';
  behaviors.stalled = () => new Promise(() => {});
  behaviors.boom = () => {
    throw new Error('exploded');
  };
});

const call = (id: string, name: string) => ({ id, name, arguments: '{}' });

it('lists the call that threw, the one that finished and the one still running when a tool throws, and fails as UNEXPECTED_ERROR', async () => {
  api.reply(
    200,
    toolRound([call('1', 'stalled'), call('2', 'ok'), call('3', 'boom')]),
  );
  const out = { stdout: '', stderr: '' };
  const code = await run(
    ['-q', 'q', '--json'],
    { OPENROUTER_API_KEY: 'sk-or-v1-marker', OPENROUTER_MODEL: 'm' },
    {
      serverURL: api.url,
      cwd: dir,
      stdin: { isTTY: false, read: async () => '' },
      stdout: sink(out, 'stdout'),
      stderr: sink(out, 'stderr'),
    },
  );
  expect(code).toBe(2);
  expect(out.stdout).toBe('');
  const object = JSON.parse(out.stderr);
  expect(matchesPublishedSchema(object)).toBe(true);
  expect(object).toMatchObject({
    success: false,
    error: { code: 'UNEXPECTED_ERROR' },
    args: { verbose: false },
  });
  expect(object.toolCalls).toEqual([
    {
      round: 1,
      name: 'stalled',
      arguments: '{}',
      output: '[TOOL_CALL_NOT_COMPLETED] Tool call did not complete',
      failed: true,
    },
    {
      round: 1,
      name: 'ok',
      arguments: '{}',
      output: '"fine"',
      failed: false,
    },
    {
      round: 1,
      name: 'boom',
      arguments: '{}',
      output: 'exploded',
      failed: true,
    },
  ]);
});
