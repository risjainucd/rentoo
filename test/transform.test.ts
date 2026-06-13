import { expect, test, describe } from 'vitest';
import { slugify, makeDisplayId } from '../scripts/lib/transform';

describe('slugify', () => {
  test('kebab-cases and strips punctuation', () => expect(slugify('2BHK Furnished, Gulab Garh!')).toBe('2bhk-furnished-gulab-garh'));
  test('appends a numeric suffix for uniqueness', () => expect(slugify('Office MI Road', 3)).toBe('office-mi-road-03'));
});

describe('makeDisplayId', () => {
  test('zero-pads to 2 digits with hash', () => expect(makeDisplayId(1)).toBe('#01'));
});
