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
  test('max of the admin "A-NN" series + 1, zero-padded to 2', async () => {
    expect(await suggestNextDisplayId(displayIdDb(['A-01', 'A-07', 'A-03']))).toBe('A-08');
  });
  test('A-01 when there are no admin-created listings', async () => {
    expect(await suggestNextDisplayId(displayIdDb([]))).toBe('A-01');
  });
  test('rolls past 2 digits', async () => {
    expect(await suggestNextDisplayId(displayIdDb(['A-98', 'A-99']))).toBe('A-100');
  });
  // The Excel importer takes display_id straight from the spreadsheet and upserts on slug only,
  // so minting into its "#NN" / "C-N" space would break a re-import on UNIQUE(display_id).
  test('never mints into the importer\'s id space', async () => {
    expect(await suggestNextDisplayId(displayIdDb(['#118', '##12', 'C-19']))).toBe('A-01');
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
  // /admin/new is a static route, so a listing slugged "new" could never be opened in the editor.
  test('never hands out the reserved "new" slug', async () => {
    expect(await uniqueSlug(slugDb([]), 'new')).toBe('new-2');
  });
});
