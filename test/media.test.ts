import { expect, test, describe } from 'vitest';
import { mediaUrl, isAllowedReferer } from '../src/lib/media';
describe('mediaUrl', () => {
  test('appends size + webp to base key', () => {
    expect(mediaUrl('properties/2bhk-gulab-garh-01/0', 'card')).toBe('/media/properties/2bhk-gulab-garh-01/0-card.webp');
  });
});
describe('isAllowedReferer', () => {
  const origin = 'https://rentoo.pages.dev';
  test('allows same-origin', () => expect(isAllowedReferer('https://rentoo.pages.dev/rent', origin)).toBe(true));
  test('allows empty referer', () => expect(isAllowedReferer(null, origin)).toBe(true));
  test('blocks foreign origin', () => expect(isAllowedReferer('https://evil.example/x', origin)).toBe(false));
});
