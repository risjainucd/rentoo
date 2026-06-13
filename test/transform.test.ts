import { expect, test, describe } from 'vitest';
import { slugify, makeDisplayId, normalizeFurnishing, normalizeSegment, normalizeStatus, rowToProperty } from '../scripts/lib/transform';

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
