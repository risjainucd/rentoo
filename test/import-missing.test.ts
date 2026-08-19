import { expect, test, describe } from 'vitest';
import {
  parseRent, bhkOf, ptypeOf, areaOf, mapUrlOf, rowHasData, sheetRowToListing,
  uniqueSlug, assertSlugSafe, esc, majorFor, planImport, buildSql,
  parseCaption, parseMoney, captionToListing,
} from '../scripts/import-missing.mjs';

// scripts/import-excel.mjs is a one-shot: it mints crypto.randomUUID() ids and index-derived
// slugs, so re-running it duplicates every listing and renames live URLs. import-missing.mjs is
// the re-runnable half — it keys on display_id and only ever INSERTs ids D1 has never seen.

describe('parseRent', () => {
  test('plain numbers pass through', () => expect(parseRent(35000)).toBe(35000));
  test('"15" is shorthand for 15000, matching import-excel', () => expect(parseRent('15')).toBe(15000));
  test('k and lakh suffixes', () => {
    expect(parseRent('90K+ maintainance')).toBe(90000);
    expect(parseRent('1.2 lakh')).toBe(120000);
  });
  test('commas are stripped', () => expect(parseRent('1,25,000')).toBe(125000));
  test('unparseable is 0, never NaN', () => {
    expect(parseRent(null)).toBe(0);
    expect(parseRent('NA')).toBe(0);
  });
});

describe('field derivation', () => {
  test('bhk from Type, studio recognised', () => {
    expect(bhkOf('3bhk+ servant')).toBe('3BHK');
    expect(bhkOf('Studio')).toBe('Studio');
    expect(bhkOf(null)).toBe(null);
  });
  test('property type normalises the sheet\'s "Appartment" typo', () => {
    expect(ptypeOf('Appartment')).toBe('apartment');
    expect(ptypeOf(' Factory')).toBe('factory');
    expect(ptypeOf(null)).toBe('property');
  });
  test('area is the last part of Location, else the Landmark', () => {
    expect(areaOf('RR Heights, Mansarovar', 'Gulab Garh')).toBe('Mansarovar');
    expect(areaOf(null, 'Barkat nagar')).toBe('Barkat nagar');
    expect(areaOf('https://maps.app.goo.gl/abc', 'Jagatpura')).toBe('Jagatpura');
  });
  test('map url is only taken from a real maps link', () => {
    expect(mapUrlOf('https://maps.app.goo.gl/xQmYySbuEYVA4L5E9?g_st=aw')).toMatch(/^https:\/\/maps\.app/);
    expect(mapUrlOf('Manglam Radiance')).toBe(null);
  });
});

describe('rowHasData', () => {
  // The sheet pre-numbers Property IDs hundreds of rows past the data. Those rows are not
  // listings, and inventing facts for them is exactly what this script must never do.
  test('an id with every other cell blank is a placeholder, not a listing', () => {
    expect(rowHasData({ 'Property ID': '#123', Type: null, 'Rent (₹)': null, Landmark: null })).toBe(false);
    expect(rowHasData({ 'Property ID': '#123', Type: '  ', Landmark: '' })).toBe(false);
  });
  test('any single fact makes it real', () => {
    expect(rowHasData({ 'Property ID': '#123', Type: '2bhk', Landmark: null })).toBe(true);
  });
});

describe('sheetRowToListing', () => {
  test('maps a residential row the way its neighbours in D1 were mapped', () => {
    const l = sheetRowToListing({
      'Property ID': '#01', Type: '3bhk', 'Rent (₹)': 35000, Landmark: 'Gulab Garh',
      'Key Features': 'Appartment', Furnishing: 'Furnished', 'Property status': 'Rented out',
      'Available for ': 'Only Family', Loction: 'RR Heights, Mansarovar',
    }, 'residential');
    expect(l).toMatchObject({
      display_id: '#01', segment: 'residential', bhk_type: '3BHK', property_type: 'apartment',
      rent_inr: 35000, furnishing: 'furnished', status: 'rented',
      neighbourhood_slug: 'mansarovar', published: 1,
    });
    expect(l.slug_base).toBe('3bhk-apartment-gulab-garh');
    expect(l.description).toBe('Apartment · Only Family');
  });

  test('a zero-rent row is inserted unpublished rather than dropped', () => {
    const l = sheetRowToListing({ 'Property ID': '#99', Type: '2bhk', 'Rent (₹)': null, Landmark: 'Sodala', 'Key Features': 'Appartment' }, 'residential');
    expect(l.rent_inr).toBe(0);
    expect(l.published).toBe(0);
  });

  test('warehouses and factories are industrial, not commercial (migration 0002)', () => {
    const w = sheetRowToListing({ 'Property ID': 'C-1', 'Key Feature': 'Warehouse', Rent: 300000, 'Area (sqft)': 12000, Location: 'Sitapura Ind', Furnishing: 'Unfurnished', Status: 'Availabe' }, 'commercial');
    expect(w.segment).toBe('industrial');
    expect(w.area_sqft).toBe(12000);
    expect(w.bhk_type).toBe(null);
    const o = sheetRowToListing({ 'Property ID': 'C-3', 'Key Feature': 'Office space', Rent: 200000, 'Area (sqft)': 3200, Location: 'C scheme ', Furnishing: 'Furnished', Status: 'Availabe' }, 'commercial');
    expect(o.segment).toBe('commercial');
    expect(o.neighbourhood_slug).toBe('c-scheme');
  });

  test('a non-numeric Area (sqft) becomes NULL rather than NaN', () => {
    const l = sheetRowToListing({ 'Property ID': 'C-5', 'Key Feature': 'Office space', Rent: 85000, 'Area (sqft)': 'NA', Location: 'Lal kothi', Status: 'Availabe' }, 'commercial');
    expect(l.area_sqft).toBe(null);
  });
});

describe('uniqueSlug', () => {
  test('returns the base when free', () => expect(uniqueSlug('office-c-scheme', new Set())).toBe('office-c-scheme'));
  test('appends -2, -3 … against slugs already live in D1', () => {
    const taken = new Set(['office-c-scheme']);
    expect(uniqueSlug('office-c-scheme', taken)).toBe('office-c-scheme-2');
    expect(uniqueSlug('office-c-scheme', taken)).toBe('office-c-scheme-3');
  });
  test('a batch cannot collide with itself', () => {
    const taken = new Set();
    expect(uniqueSlug('2bhk-apartment-sodala', taken)).toBe('2bhk-apartment-sodala');
    expect(uniqueSlug('2bhk-apartment-sodala', taken)).toBe('2bhk-apartment-sodala-2');
  });
  test('never hands out the reserved "new" slug', () => expect(uniqueSlug('new', new Set())).toBe('new-2'));
  test('falls back to "listing" for an empty base', () => expect(uniqueSlug('---', new Set())).toBe('listing'));
});

describe('assertSlugSafe', () => {
  // Slugs are interpolated into SQL and into R2 object keys, so a bad one is a hard stop.
  test('accepts kebab-case', () => expect(assertSlugSafe('3bhk-apartment-mansarovar')).toBe('3bhk-apartment-mansarovar'));
  test('rejects quotes, slashes, spaces, uppercase', () => {
    for (const bad of ["o'brien", 'a/b', 'a b', 'Abc', '', 'a_b']) expect(() => assertSlugSafe(bad)).toThrow();
  });
});

describe('esc', () => {
  test('doubles single quotes', () => expect(esc("Raja's Park")).toBe("'Raja''s Park'"));
  test('null and empty become NULL', () => { expect(esc(null)).toBe('NULL'); expect(esc('')).toBe('NULL'); });
});

describe('majorFor', () => {
  test('a new tag that IS a major area maps itself', () => expect(majorFor('mansarovar')).toEqual({ major_slug: 'mansarovar', major_area: 'Mansarovar' }));
  test('a landmark tag is left unmapped for a human, never guessed', () => expect(majorFor('some-new-tower')).toEqual({ major_slug: null, major_area: null }));
});

const cand = (display_id: string, over = {}) => ({
  display_id, segment: 'residential', bhk_type: '2BHK', property_type: 'apartment',
  rent_inr: 25000, area_sqft: null, furnishing: 'semi-furnished', status: 'available',
  landmark: 'Near park', neighbourhood_slug: 'mansarovar', neighbourhood_name: 'Mansarovar',
  map_url: null, description: 'Apartment', published: 1, slug_base: '2bhk-apartment-near-park',
  source: 'sheet', ...over,
});
const NB = [{ slug: 'mansarovar', name: 'Mansarovar', major_slug: 'mansarovar', major_area: 'Mansarovar' }];

describe('planImport', () => {
  test('inserts an id D1 has never seen', () => {
    const p = planImport({ candidates: [cand('#123')], dbListings: [], dbNeighbourhoods: NB });
    expect(p.insert.map((r) => r.display_id)).toEqual(['#123']);
    expect(p.insert[0].slug).toBe('2bhk-apartment-near-park');
    expect(p.insert[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('an id already in D1 is skipped, and no update is ever produced', () => {
    const p = planImport({
      candidates: [cand('#01', { rent_inr: 999999, slug_base: 'brand-new-base' })],
      dbListings: [{ display_id: '#01', slug: 'existing-slug-01' }], dbNeighbourhoods: NB,
    });
    expect(p.insert).toEqual([]);
    expect(p.skipExisting).toEqual(['#01']);
    expect(p).not.toHaveProperty('update');
    expect(p).not.toHaveProperty('delete');
  });

  test('matches display_id regardless of surrounding whitespace', () => {
    const p = planImport({ candidates: [cand(' #01 ')], dbListings: [{ display_id: '#01', slug: 's' }], dbNeighbourhoods: NB });
    expect(p.insert).toEqual([]);
    expect(p.skipExisting).toEqual(['#01']);
  });

  test('never reuses a slug that is already a live URL', () => {
    const p = planImport({
      candidates: [cand('#123')],
      dbListings: [{ display_id: '#01', slug: '2bhk-apartment-near-park' }], dbNeighbourhoods: NB,
    });
    expect(p.insert[0].slug).toBe('2bhk-apartment-near-park-2');
  });

  test('a duplicated Property ID is an error, not a silent double insert', () => {
    expect(() => planImport({ candidates: [cand('#123'), cand('#123')], dbListings: [], dbNeighbourhoods: NB })).toThrow(/#123/);
  });

  test('a new area gets a neighbourhoods row so it shows under an Area filter', () => {
    const p = planImport({
      candidates: [cand('#123', { neighbourhood_slug: 'jhotwara', neighbourhood_name: 'Jhotwara' })],
      dbListings: [], dbNeighbourhoods: NB, nextOrder: 88,
    });
    expect(p.newNeighbourhoods).toEqual([{ slug: 'jhotwara', name: 'Jhotwara', display_order: 89, major_slug: 'jhotwara', major_area: 'Jhotwara' }]);
  });

  test('an existing area never gets a duplicate row', () => {
    const p = planImport({ candidates: [cand('#123')], dbListings: [], dbNeighbourhoods: NB });
    expect(p.newNeighbourhoods).toEqual([]);
  });

  test('an unmappable new area is flagged rather than filed under a guess', () => {
    const p = planImport({
      candidates: [cand('#123', { neighbourhood_slug: 'some-new-tower', neighbourhood_name: 'Some New Tower' })],
      dbListings: [], dbNeighbourhoods: NB,
    });
    expect(p.newNeighbourhoods[0].major_slug).toBe(null);
    expect(p.warnings.join(' ')).toMatch(/some-new-tower/);
  });

  test('rejects values the schema CHECK constraints would bounce', () => {
    expect(() => planImport({ candidates: [cand('#123', { segment: 'retail' })], dbListings: [], dbNeighbourhoods: NB })).toThrow(/segment/);
    expect(() => planImport({ candidates: [cand('#123', { status: 'maybe' })], dbListings: [], dbNeighbourhoods: NB })).toThrow(/status/);
    expect(() => planImport({ candidates: [cand('#123', { furnishing: 'sort of' })], dbListings: [], dbNeighbourhoods: NB })).toThrow(/furnishing/);
  });

  test('a zero-rent listing is inserted as an unpublished draft, not published empty', () => {
    const p = planImport({ candidates: [cand('#123', { rent_inr: 0, published: 1 })], dbListings: [], dbNeighbourhoods: NB });
    expect(p.insert[0].published).toBe(0);
    expect(p.warnings.join(' ')).toMatch(/rent is 0/);
  });
});

describe('buildSql', () => {
  test('emits INSERT only — no UPDATE, no DELETE, and conflicts do nothing', () => {
    const p = planImport({ candidates: [cand('#123')], dbListings: [], dbNeighbourhoods: NB });
    const sql = buildSql(p);
    expect(sql).toMatch(/^INSERT INTO properties/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING;$/);
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP/i);
  });

  test('escapes quotes in free text', () => {
    const p = planImport({ candidates: [cand('#123', { landmark: "Raja's Park" })], dbListings: [], dbNeighbourhoods: NB });
    expect(buildSql(p)).toContain("'Raja''s Park'");
  });

  test('refuses to emit SQL for an unsafe slug', () => {
    const p = planImport({ candidates: [cand('#123')], dbListings: [], dbNeighbourhoods: NB });
    p.insert[0].slug = "evil'; DROP TABLE properties;--";
    expect(() => buildSql(p)).toThrow(/unsafe slug/);
  });

  test('numeric columns are written as numbers, never as quoted strings', () => {
    const p = planImport({ candidates: [cand('#123', { rent_inr: 25000, area_sqft: 1100 })], dbListings: [], dbNeighbourhoods: NB });
    const sql = buildSql(p);
    expect(sql).toContain(',25000,1100,');
  });
});

describe('parseMoney', () => {
  test('reads the Indian grouping used in captions', () => {
    expect(parseMoney('₹3,00,000 per month')).toBe(300000);
    expect(parseMoney('95,000')).toBe(95000);
  });
  test('first number wins, so a ₹/sqft aside is ignored', () => {
    expect(parseMoney('₹80,000 per month (₹20/sq. ft.)')).toBe(80000);
  });
});

describe('parseCaption', () => {
  const RESI = [
    '#03 FOR RENT: 3BHK SEMI-FURNISHED NEAR ISKCON TEMPLE',
    '',
    '🏠 Property: 3BHK Apartment',
    '📍 Location: Near ISKCON Temple, Mansarovar',
    '💰 Rent: ₹23,000 / Month',
    '🛋️ Status: Semi-Furnished',
  ].join('\n');

  test('pulls bhk, type, location, rent and furnishing out of prose', () => {
    expect(parseCaption(RESI)).toEqual({
      bhk_type: '3BHK', property_type: 'apartment', location: 'Near ISKCON Temple, Mansarovar',
      rent_inr: 23000, furnishing: 'semi-furnished', area_sqft: null,
    });
  });

  test('reads Size/Area only when it is actually a square-foot figure', () => {
    expect(parseCaption('📏 Size: 12,000 Sq. Ft.').area_sqft).toBe(12000);
    expect(parseCaption('📐 Area: 7,500 Sq. Ft.').area_sqft).toBe(7500);
    expect(parseCaption('📏 Size: 15 Rooms + Banquet').area_sqft).toBe(null);
  });

  test('"Ready to Move" is not a furnishing claim', () => {
    expect(parseCaption('🛋️ Status: Ready to Move').furnishing).toBe(null);
    expect(parseCaption('🛋️ Status: Fully Furnished (Ready to Move)').furnishing).toBe('furnished');
  });

  test('a bracketed placeholder location is not a location', () => {
    expect(parseCaption('📍 Location: [Location]').location).toBe(null);
  });

  test('a ₹/sq-ft rate is refused rather than treated as a monthly rent', () => {
    expect(parseCaption('💰 Rent: ₹20 per sq ft').rent_inr).toBe(0);
  });

  test('everything a caption can never carry comes back missing', () => {
    const c = parseCaption(RESI);
    expect(c).not.toHaveProperty('status');
    expect(c).not.toHaveProperty('map_url');
  });
});

describe('captionToListing', () => {
  test('a caption-built listing defaults status to available and has no map url', () => {
    const l = captionToListing('##02', [
      '🏠 Property: 5BHK + Basement Villa',
      '📍 Location: Vaishali Nagar, Jaipur',
      '🛋️ Status: Semi-Furnished',
      '💰 Rent: 95,000',
    ].join('\n'));
    expect(l).toMatchObject({
      display_id: '##02', segment: 'residential', bhk_type: '5BHK', property_type: 'villa',
      rent_inr: 95000, furnishing: 'semi-furnished', status: 'available', map_url: null,
      neighbourhood_slug: 'jaipur', published: 1,
    });
  });

  test('a commercial caption lands in the right segment', () => {
    const l = captionToListing('C-1', [
      '🏢 Warehouse for Rent',
      '📍 Location: Sitapura Industrial Area',
      '📏 Size: 12,000 Sq. Ft.',
      '💰 Rent: ₹3,00,000 per month',
    ].join('\n'), 'commercial');
    expect(l.segment).toBe('industrial');
    expect(l.area_sqft).toBe(12000);
    expect(l.bhk_type).toBe(null);
  });

  test('caption-sourced rows are flagged for review before they can go live', () => {
    const l = { ...captionToListing('#123', '🏠 Property: 2BHK Apartment\n💰 Rent: ₹20,000'), source: 'caption' };
    const p = planImport({ candidates: [l], dbListings: [], dbNeighbourhoods: NB });
    expect(p.warnings.join(' ')).toMatch(/marketing caption/);
  });
});
