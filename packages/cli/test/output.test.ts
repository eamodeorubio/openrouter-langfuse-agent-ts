import { describe, expect, it } from 'vitest';
import { outputSchema, serialize } from '../src/output.js';
import { EXAMPLES } from './outputExamples.js';

describe('outputSchema', () => {
  it.each(EXAMPLES)(
    'accepts or rejects %s (valid: %s)',
    (_name, object, valid) => {
      expect(outputSchema.safeParse(object).success).toBe(valid);
    },
  );
});

describe('serialize', () => {
  it('writes the object on one line, ended by a newline', () => {
    expect(
      serialize({ success: false, error: { code: 'X', message: 'a\nb' } }),
    ).toBe('{"success":false,"error":{"code":"X","message":"a\\nb"}}\n');
  });
});
