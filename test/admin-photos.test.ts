import { expect, test, describe } from 'vitest';
import {
  renditionPlan, watermarkLayout, normalizePhotoOrder, photoBaseKey, randomPhotoToken,
} from '../src/lib/admin-photos';

describe('renditionPlan', () => {
  test('uses full target widths for a large source', () => {
    expect(renditionPlan(4000).map((r) => [r.name, r.width])).toEqual([
      ['card', 600], ['gallery', 1200], ['full', 2000],
    ]);
  });
  test('never upscales past the source width', () => {
    expect(renditionPlan(800).map((r) => r.width)).toEqual([600, 800, 800]);
  });
});

describe('watermarkLayout', () => {
  test('centers a 0.6x-width wordmark on a landscape photo', () => {
    const l = watermarkLayout(1000, 750, 4); // logo aspect 4:1
    expect(l.w).toBe(600);            // 0.6 * 1000
    expect(l.h).toBe(150);            // 600 / 4
    expect(l.left).toBe(200);         // (1000-600)/2
    expect(l.top).toBe(300);          // (750-150)/2
  });
  test('clamps the wordmark to fit inside a tall/narrow photo', () => {
    const l = watermarkLayout(300, 1200, 4); // 0.6*300=180 wide, 45 tall — fits
    expect(l.w).toBeLessThanOrEqual(Math.round(300 * 0.92));
    expect(l.h).toBeLessThanOrEqual(Math.round(1200 * 0.92));
  });
  test('never smaller than the 80px floor at its target', () => {
    const l = watermarkLayout(100, 100, 4);
    expect(l.w).toBeGreaterThanOrEqual(80 - 100 * 0.08); // floor minus clamp headroom
  });
});

describe('normalizePhotoOrder', () => {
  test('assigns contiguous order and cover only to index 0', () => {
    expect(normalizePhotoOrder(['a', 'b', 'c'])).toEqual([
      { id: 'a', display_order: 0, is_cover: 1 },
      { id: 'b', display_order: 1, is_cover: 0 },
      { id: 'c', display_order: 2, is_cover: 0 },
    ]);
  });
  test('empty list yields empty plan', () => {
    expect(normalizePhotoOrder([])).toEqual([]);
  });
});

describe('photoBaseKey', () => {
  test('builds an opaque per-photo base key', () => {
    expect(photoBaseKey('2bhk-gulab-garh-01', 'abc123')).toBe('properties/2bhk-gulab-garh-01/u-abc123');
  });
  test('rejects a slug with illegal characters', () => {
    expect(() => photoBaseKey('../evil', 'x')).toThrow();
  });
});

describe('randomPhotoToken', () => {
  test('returns a 12-char lowercase hex token', () => {
    expect(randomPhotoToken()).toMatch(/^[0-9a-f]{12}$/);
  });
});
