import path from 'node:path';
import { describe, expect, it } from 'vitest';
import CliProvider from '../src/provider/cli.js';

const stub = path.join(import.meta.dirname, 'fixtures/stub-cli.mjs');

const call = (question: string) =>
  new CliProvider({ config: { cli: stub } }).callApi(question, {
    vars: { model: 'm/one' },
  });

describe('the provider id', () => {
  it('is ask-openrouter-cli unless promptfoo gives one', () => {
    expect(new CliProvider().id()).toBe('ask-openrouter-cli');
    expect(new CliProvider({ config: {} }).id()).toBe('ask-openrouter-cli');
    expect(new CliProvider({ id: 'other' }).id()).toBe('other');
  });
});

describe('a call without a model', () => {
  const provider = new CliProvider({ config: { cli: stub } });

  it('fails without a context, and without vars', async () => {
    expect((await provider.callApi('ok')).error).toMatch(/vars\.model/);
    expect((await provider.callApi('ok', {})).error).toMatch(/vars\.model/);
  });

  it('fails when the model is only spaces, or is not text', async () => {
    expect(
      (await provider.callApi('ok', { vars: { model: '  ' } })).error,
    ).toMatch(/vars\.model/);
    expect(
      (await provider.callApi('ok', { vars: { model: 7 } })).error,
    ).toMatch(/vars\.model/);
  });

  it('says the provider does not read OPENROUTER_MODEL', async () => {
    expect((await provider.callApi('ok')).error).toContain(
      'does not read OPENROUTER_MODEL',
    );
  });
});

describe('the usage a run reports', () => {
  it('is left out when the CLI sent none', async () => {
    const result = await call('nousage');
    expect(result.error).toBeUndefined();
    expect('cost' in result).toBe(false);
    expect('tokenUsage' in result).toBe(false);
  });

  it('reports the cost without the tokens when a token count is missing', async () => {
    const result = await call('partial');
    expect(result.cost).toBe(0.3);
    expect('tokenUsage' in result).toBe(false);
  });

  it('reports the tokens without the cost when the cost is not a number', async () => {
    const result = await call('strcost');
    expect('cost' in result).toBe(false);
    expect(result.tokenUsage).toEqual({ prompt: 1, completion: 2, total: 3 });
  });
});

describe('the errors of a run', () => {
  it('say the exit code and the stderr text, trimmed', async () => {
    const result = await call('exit1');
    expect(result.error).toBe(
      'The CLI exited with code 1: {"success":false,"error":{"code":"API_ERROR","message":"boom"}}',
    );
  });

  it('say what the CLI wrote when it is not a success object, up to 200 characters', async () => {
    const result = await call('long');
    expect(result.error).toBe(
      `The CLI wrote unreadable output, not a --json success object: ${'x'.repeat(200)}`,
    );
  });

  it('treat the text null as unreadable output', async () => {
    const result = await call('null');
    expect(result.error).toMatch(/^The CLI wrote unreadable output/);
  });

  it('name the signal when the CLI is stopped by one', async () => {
    const result = await call('killed');
    expect(result.error).toBe('The CLI did not finish: SIGKILL');
  });
});

describe('the token usage, for every subset of the three counts', () => {
  const FIELDS = ['promptTokens', 'completionTokens', 'totalTokens'] as const;

  for (let mask = 0; mask < 8; mask++) {
    const present = FIELDS.filter((_, index) => mask & (1 << index));
    it(`is reported only when all three are there: ${present.join(', ') || 'none'}`, async () => {
      const usage = Object.fromEntries(
        present.map((field, index) => [field, index + 1]),
      );
      const result = await call(
        `usage:${JSON.stringify({ ...usage, cost: 0.25 })}`,
      );
      expect(result.cost).toBe(0.25);
      if (present.length === 3) {
        expect(result.tokenUsage).toEqual({
          prompt: 1,
          completion: 2,
          total: 3,
        });
      } else {
        expect('tokenUsage' in result).toBe(false);
      }
    });
  }
});
