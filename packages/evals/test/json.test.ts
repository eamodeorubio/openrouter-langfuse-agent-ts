import { describe, expect, it } from 'vitest';
import { finite, isObject, parseJson } from '../src/json.js';

describe('parseJson', () => {
  it('reads JSON text, and gives null for text that is not JSON', () => {
    expect(parseJson('{"a":[1,null]}')).toEqual({ a: [1, null] });
    expect(parseJson('null')).toBeNull();
    expect(parseJson('{oops')).toBeNull();
    expect(parseJson('')).toBeNull();
  });
});

describe('isObject', () => {
  it('is true for an object and false for null, a list and a primitive', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject('text')).toBe(false);
    expect(isObject(3)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe('finite', () => {
  it('is true for numbers and false for NaN, infinity and non-numbers', () => {
    expect(finite(0)).toBe(true);
    expect(finite(-1.5)).toBe(true);
    expect(finite(Number.NaN)).toBe(false);
    expect(finite(Number.POSITIVE_INFINITY)).toBe(false);
    expect(finite('1')).toBe(false);
    expect(finite(null)).toBe(false);
  });
});
