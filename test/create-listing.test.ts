import { expect, test, describe } from 'vitest';
import { slugify } from '../src/lib/sql';
import { suggestNextDisplayId, uniqueSlug } from '../src/lib/db';
import type { D1Database } from '@cloudflare/workers-types';

describe('slugify', () => {
  test('lowercases, collapses non-alphanumerics to single hyphens, trims', () => {
    expect(slugify('2BHK Apartment, C-Scheme')).toBe('2bhk-apartment-c-scheme');
    expect(slugify('  Office   Space  ')).toBe('office-space');
    expect(slugify('Warehouse @ Sitapura!')).toBe('warehouse-sitapura');
  });
  test('empty for all-symbol input', () => {
    expect(slugify('---')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

// prepare().all() → {results}; prepare().bind(v).first() → row|null (row present if slug taken)
function displayIdDb(ids: string[]): D1Database {
  const stmt = { all: async () => ({ results: ids.map((display_id) => ({ display_id })) }) };
  return { prepare: () => stmt } as unknown as D1Database;
}
function slugDb(taken: string[]): D1Database {
  const set = new Set(taken);
  return {
    prepare: () => {
      let bound: string | null = null;
      const stmt = {
        bind: (v: string) => { bound = v; return stmt; },
        first: async () => (bound != null && set.has(bound) ? { x: 1 } : null),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('suggestNextDisplayId', () => {
  test('max numeric part + 1, zero-padded to 2', async () => {
    expect(await suggestNextDisplayId(displayIdDb(['#01', '#07', '#03']))).toBe('#08');
  });
  test('#01 when there are no listings', async () => {
    expect(await suggestNextDisplayId(displayIdDb([]))).toBe('#01');
  });
  test('rolls past 2 digits', async () => {
    expect(await suggestNextDisplayId(displayIdDb(['#98', '#99']))).toBe('#100');
  });
});

describe('uniqueSlug', () => {
  test('returns the base when free', async () => {
    expect(await uniqueSlug(slugDb([]), 'office-c-scheme')).toBe('office-c-scheme');
  });
  test('appends -2, -3 … when taken', async () => {
    expect(await uniqueSlug(slugDb(['office-c-scheme']), 'office-c-scheme')).toBe('office-c-scheme-2');
    expect(await uniqueSlug(slugDb(['office-c-scheme', 'office-c-scheme-2']), 'office-c-scheme')).toBe('office-c-scheme-3');
  });
  test('falls back to "listing" for an empty base', async () => {
    expect(await uniqueSlug(slugDb([]), '')).toBe('listing');
  });
});
