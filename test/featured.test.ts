import { expect, test, describe } from 'vitest';
import { getFeaturedListing } from '../src/lib/db';

// Minimal D1 stub: prepare().bind().all() returns queued responses in call order.
// getFeaturedListing issues the listing query first, then (only if a flagged row
// is found) the attachPhotos query — so [listingRows, photoRows] is the order.
function fakeDb(listingRows: Record<string, unknown>[], photoRows: { slug: string; key: string }[] = []) {
  const responses = [{ results: listingRows }, { results: photoRows }];
  let i = 0;
  const stmt: Record<string, unknown> = {
    bind: () => stmt,
    all: async () => responses[Math.min(i++, responses.length - 1)],
  };
  return { prepare: () => stmt } as unknown as import('@cloudflare/workers-types').D1Database;
}

const flaggedRow = {
  slug: 'villa-x', display_id: '#07', segment: 'residential', bhk_type: '3BHK',
  property_type: 'apartment', rent_inr: 42000, landmark: 'near Central Park',
  furnishing: 'furnished', status: 'available', neighbourhood_slug: 'c-scheme',
  likes: 3, featured: 1, cover_key: 'properties/villa-x/0', cover_w: 1200, cover_h: 800,
};

describe('getFeaturedListing', () => {
  test('returns the flagged card with its photos', async () => {
    const card = await getFeaturedListing(
      fakeDb([flaggedRow], [{ slug: 'villa-x', key: 'properties/villa-x/0' }]),
    );
    expect(card).not.toBeNull();
    expect(card!.slug).toBe('villa-x');
    expect(card!.featured).toBe(1);
    expect(card!.title).toBe('3BHK apartment');
    expect(card!.photos).toEqual(['properties/villa-x/0']);
  });

  test('falls back to the newest listing when nothing is flagged', async () => {
    // With no featured=1 rows the 'featured' sort still returns the newest available row, and
    // that is what the home page shows: the slot carries the only context-prefilled WhatsApp
    // CTA on the page, so leaving it dark costs more than spotlighting an unflagged listing.
    const card = await getFeaturedListing(fakeDb([{ ...flaggedRow, featured: 0 }]));
    expect(card).not.toBeNull();
    expect(card!.slug).toBe('villa-x');
  });

  test('returns null when there are no listings at all', async () => {
    const card = await getFeaturedListing(fakeDb([]));
    expect(card).toBeNull();
  });
});
