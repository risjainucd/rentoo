import { expect, test, describe } from 'vitest';
import { planListings, planPhotos, MUTABLE_FIELDS } from '../scripts/lib/sync-plan.mjs';

// The sheet is the source of truth for listing FACTS (rent, status, furnishing…), never for
// identity. scripts/import-excel.mjs mints crypto.randomUUID() ids and index-derived slugs, so
// re-running it would rename live URLs; the sync matches on display_id ("#01") and never
// regenerates a slug for a listing that already exists.

const row = (display_id: string, over = {}) => ({
  display_id, segment: 'residential', bhk_type: '2BHK', property_type: 'apartment',
  rent_inr: 25000, furnishing: 'semi-furnished', status: 'available', landmark: 'Near park',
  neighbourhood_slug: 'mansarovar', published: 1, ...over,
});
const dbRow = (display_id: string, over = {}) => ({ ...row(display_id), slug: `listing-${display_id.slice(1)}`, id: 'uuid-' + display_id, ...over });

describe('planListings', () => {
  test('a listing only in the sheet is created', () => {
    const p = planListings([row('#01')], []);
    expect(p.create.map((c) => c.display_id)).toEqual(['#01']);
    expect(p.update).toEqual([]);
    expect(p.missing).toEqual([]);
  });

  test('an unchanged listing produces no work', () => {
    const p = planListings([row('#01')], [dbRow('#01')]);
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
  });

  test('a changed field is reported with both values', () => {
    const p = planListings([row('#01', { rent_inr: 27000 })], [dbRow('#01')]);
    expect(p.update).toHaveLength(1);
    expect(p.update[0].display_id).toBe('#01');
    const changes = p.update[0].changes as Record<string, [unknown, unknown]>;
    expect(changes.rent_inr).toEqual([25000, 27000]);
  });

  test('never proposes changing a slug or id, whatever the sheet says', () => {
    // Slugs are live URLs. A renamed landmark must not silently move a listing.
    const p = planListings([row('#01', { slug: 'brand-new-slug', id: 'different' })], [dbRow('#01')]);
    expect(p.update).toEqual([]);
    expect(MUTABLE_FIELDS).not.toContain('slug');
    expect(MUTABLE_FIELDS).not.toContain('id');
    expect(MUTABLE_FIELDS).not.toContain('display_id');
  });

  test('a listing only in the database is reported, never deleted', () => {
    const p = planListings([], [dbRow('#09')]);
    expect(p.missing.map((m) => m.display_id)).toEqual(['#09']);
    expect(p).not.toHaveProperty('delete');
  });

  test('ignores sheet rows with no Property ID', () => {
    const p = planListings([row(''), row('#02')], []);
    expect(p.create.map((c) => c.display_id)).toEqual(['#02']);
  });

  test('a duplicated Property ID is an error, not a silent overwrite', () => {
    expect(() => planListings([row('#01'), row('#01')], [])).toThrow(/#01/);
  });

  test('matches on display_id regardless of surrounding whitespace', () => {
    const p = planListings([row(' #01 ')], [dbRow('#01')]);
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
  });
});

describe('planPhotos', () => {
  test('uploads only Drive files with no media row yet', () => {
    const p = planPhotos('a-slug', ['1.jpg', '2.jpg', '3.jpg'], ['1.jpg']);
    expect(p.upload).toEqual(['2.jpg', '3.jpg']);
  });

  test('nothing to do when Drive matches what is stored', () => {
    expect(planPhotos('a-slug', ['1.jpg'], ['1.jpg']).upload).toEqual([]);
  });

  test('a file removed from Drive is reported, never deleted from R2', () => {
    const p = planPhotos('a-slug', ['1.jpg'], ['1.jpg', 'gone.jpg']);
    expect(p.missing).toEqual(['gone.jpg']);
    expect(p).not.toHaveProperty('delete');
  });

  test('skips non-images so stray files in a Drive folder cannot break a run', () => {
    const p = planPhotos('a-slug', ['1.jpg', 'notes.pdf', '.DS_Store', '2.HEIC'], []);
    expect(p.upload).toEqual(['1.jpg', '2.HEIC']);
  });

  test('orders uploads stably, so the cover photo does not move between runs', () => {
    const p = planPhotos('a-slug', ['10.jpg', '2.jpg', '1.jpg'], []);
    expect(p.upload).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });
});
