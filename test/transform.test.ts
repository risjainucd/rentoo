import { expect, test, describe } from 'vitest';
import { slugify, makeDisplayId, normalizeFurnishing, normalizeSegment, normalizeStatus, rowToProperty, r2KeyFor, coverAndOrder } from '../scripts/lib/transform';

describe('slugify', () => {
  test('kebab-cases and strips punctuation', () => expect(slugify('2BHK Furnished, Gulab Garh!')).toBe('2bhk-furnished-gulab-garh'));
  test('appends a numeric suffix for uniqueness', () => expect(slugify('Office MI Road', 3)).toBe('office-mi-road-03'));
});

describe('makeDisplayId', () => {
  test('zero-pads to 2 digits with hash', () => expect(makeDisplayId(1)).toBe('#01'));
});

describe('enum normalisation', () => {
  test('furnishing synonyms', () => { expect(normalizeFurnishing('Semi Furnished')).toBe('semi-furnished'); expect(normalizeFurnishing('FULLY FURNISHED')).toBe('furnished'); });
  test('segment from property type', () => { expect(normalizeSegment('Office')).toBe('commercial'); expect(normalizeSegment('2BHK Apartment')).toBe('residential'); });
  test('status synonyms + default', () => {
    expect(normalizeStatus('Rented')).toBe('rented');
    expect(normalizeStatus('On Hold')).toBe('on-hold');
    expect(normalizeStatus('Available')).toBe('available');
    expect(normalizeStatus('anything else')).toBe('available');
  });
});

describe('rowToProperty', () => {
  test('maps a spreadsheet row to a Property', () => {
    const p = rowToProperty({ Title: '2BHK Furnished Gulab Garh', BHK: '2BHK', Type: 'Apartment', Rent: '35,000', Area: '1100', Furnishing: 'Furnished', Landmark: 'near Gulab Garh', Neighbourhood: 'Mansarovar', Status: 'Available', Description: 'Nice flat' }, 1);
    expect(p.display_id).toBe('#01');
    expect(p.slug).toBe('2bhk-furnished-gulab-garh-01');
    expect(p.segment).toBe('residential');
    expect(p.rent_inr).toBe(35000);
    expect(p.area_sqft).toBe(1100);
    expect(p.neighbourhood_slug).toBe('mansarovar');
    expect(p.published).toBe(1);
  });
});

describe('r2KeyFor', () => {
  test('builds base + size path', () => expect(r2KeyFor('2bhk-gulab-garh-01', 0, 'card')).toBe('properties/2bhk-gulab-garh-01/0-card.webp'));
});

describe('coverAndOrder', () => {
  test('marks *-cover file as cover, else first file', () => {
    expect(coverAndOrder(['b.jpg', 'a-cover.jpg', 'c.jpg'])).toEqual([
      { file: 'a-cover.jpg', index: 0, isCover: true },
      { file: 'b.jpg', index: 1, isCover: false },
      { file: 'c.jpg', index: 2, isCover: false },
    ]);
  });
  test('first file is cover when none marked', () => {
    expect(coverAndOrder(['x.jpg', 'y.jpg'])[0]).toEqual({ file: 'x.jpg', index: 0, isCover: true });
  });
});
