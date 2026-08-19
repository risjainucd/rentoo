import { expect, test, describe } from 'vitest';
import { titleCase, withLocative, perSqftLabel } from '../src/lib/utils';

// These three feed the page <title> and meta description on every detail page, which is
// what a WhatsApp link preview renders — PRODUCT.md's highest-traffic surface.

describe('titleCase', () => {
  test('cases every word of a stored lowercase type', () => {
    expect(titleCase('office space')).toBe('Office Space');
    expect(titleCase('factory')).toBe('Factory');
    expect(titleCase('industrial land')).toBe('Industrial Land');
  });
  test('leaves already-cased text alone', () => {
    expect(titleCase('Office Space')).toBe('Office Space');
  });
  test('does not split a leading digit run', () => {
    expect(titleCase('2bhk apartment')).toBe('2bhk Apartment');
  });
});

describe('withLocative', () => {
  test('prefixes a bare landmark', () => {
    expect(withLocative('diona')).toBe('near diona');
    expect(withLocative('Golden landmark')).toBe('near Golden landmark');
  });
  test('never doubles a locative the landmark already carries', () => {
    expect(withLocative('near diona')).toBe('near diona');
    expect(withLocative('Near Diona')).toBe('Near Diona');
    expect(withLocative('Opp jpi pre school')).toBe('Opp jpi pre school');
    expect(withLocative('opposite the mall')).toBe('opposite the mall');
    expect(withLocative('behind city park')).toBe('behind city park');
    expect(withLocative('next to the metro')).toBe('next to the metro');
  });
  test('trims, and treats blank or missing as absent', () => {
    expect(withLocative('  Diona  ')).toBe('near Diona');
    expect(withLocative('   ')).toBeNull();
    expect(withLocative(null)).toBeNull();
    expect(withLocative(undefined)).toBeNull();
  });
});

describe('perSqftLabel', () => {
  test('keeps a decimal below ₹10 instead of rounding a real rate to ₹1', () => {
    expect(perSqftLabel(100000, 175000)).toBe('₹0.6/sqft');
    expect(perSqftLabel(9500, 1000)).toBe('₹9.5/sqft');
  });
  test('a sub-₹0.50 rate still renders rather than rounding to a falsy 0', () => {
    expect(perSqftLabel(40000, 100000)).toBe('₹0.4/sqft');
  });
  test('rounds at or above ₹10', () => {
    expect(perSqftLabel(24000, 1200)).toBe('₹20/sqft');
  });
  test('returns null when the area is missing or unusable', () => {
    expect(perSqftLabel(24000, null)).toBeNull();
    expect(perSqftLabel(24000, undefined)).toBeNull();
    expect(perSqftLabel(24000, 0)).toBeNull();
  });
});
