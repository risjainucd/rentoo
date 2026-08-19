import { expect, test, describe } from 'vitest';
import { buildListingsQuery, mapRowToCard, parseListingFilters } from '../src/lib/sql';
describe('buildListingsQuery', () => {
  test('defaults: published, newest first, page 1 of 12', () => {
    const { sql, params } = buildListingsQuery({});
    expect(sql).toContain('p.published = 1');
    expect(sql).toContain('p.segment');
    expect(sql).toContain('LEFT JOIN property_media pm');
    expect(sql).toMatch(/ORDER BY p\.created_at DESC/);
    expect(params).toEqual([12, 0]);
  });
  test('filters compose with bound params in order', () => {
    const { sql, params } = buildListingsQuery({ segment: 'residential', neighbourhood: 'mansarovar', minRent: 10000, maxRent: 40000, page: 2, perPage: 10 });
    expect(sql).toContain('p.segment = ?');
    expect(sql).toContain('p.neighbourhood_slug = ?');
    expect(sql).toContain('p.rent_inr >= ?');
    expect(sql).toContain('p.rent_inr <= ?');
    expect(params).toEqual(['residential', 'mansarovar', 10000, 40000, 10, 10]);
  });
});
describe('mapRowToCard', () => {
  test('builds a ListingCard incl. title + segment', () => {
    const card = mapRowToCard({ slug: 's', display_id: '#01', segment: 'residential', bhk_type: '2BHK', property_type: 'apartment', rent_inr: 35000, landmark: 'near Gulab Garh', furnishing: 'furnished', status: 'available', neighbourhood_slug: 'mansarovar', cover_key: 'properties/s/0', cover_w: 1200, cover_h: 900 });
    expect(card.title).toBe('2BHK Apartment'); // property_type is stored lowercase; the mapper cases it
    expect(card.segment).toBe('residential');
    expect(card.cover_key).toBe('properties/s/0');
  });
});
describe('parseListingFilters', () => {
  test('coerces query params to typed ListingFilters', () => {
    const f = parseListingFilters(new URL('https://x/rent?segment=residential&neighbourhood=mansarovar&bhk=2BHK&furnishing=furnished&minRent=10000&maxRent=40000&page=2'));
    expect(f).toEqual({ segment: 'residential', neighbourhood: 'mansarovar', bhk: '2BHK', furnishing: 'furnished', minRent: 10000, maxRent: 40000, page: 2 });
  });
  test('omits absent params and ignores junk numbers', () => {
    expect(parseListingFilters(new URL('https://x/rent?minRent=abc'))).toEqual({});
  });
});
