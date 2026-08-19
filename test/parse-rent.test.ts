import { expect, test, describe } from 'vitest';
import { parseRent, parseAreaSqft } from '../scripts/lib/parse-rent.mjs';

// The Commercial sheet quotes some rents PER SQUARE FOOT ("20 psf", "15psf", "20 per sqft").
// The original parser took the leading number and then applied its "under 1000 means thousands"
// shorthand, so a 35,000 sqft warehouse at 20/sqft went live at ₹20,000 instead of ₹700,000.

describe('parseRent', () => {
  test('a plain monthly figure passes through', () => {
    expect(parseRent(200000)).toBe(200000);
    expect(parseRent('35,000')).toBe(35000);
  });

  test('shorthand suffixes expand', () => {
    expect(parseRent('75k')).toBe(75000);
    expect(parseRent('1.5 lakh')).toBe(150000);
  });

  test('a bare small number is thousands, not rupees', () => {
    expect(parseRent('28')).toBe(28000);   // residential sheets write "28" for ₹28,000
  });

  test('a per-square-foot rate is multiplied by the area', () => {
    expect(parseRent('20 per sqft', 4000)).toBe(80000);    // C-7
    expect(parseRent('20 psf', 35000)).toBe(700000);       // C-14
    expect(parseRent('15psf', 12500)).toBe(187500);        // C-19
    expect(parseRent('20/sq ft', 1000)).toBe(20000);
  });

  test('a per-square-foot rate without an area yields 0, never a bare rate', () => {
    // 0 leaves the listing unpublished, which is recoverable. A number 1000x off is not.
    expect(parseRent('20 psf')).toBe(0);
    expect(parseRent('20 psf', 0)).toBe(0);
    expect(parseRent('20 psf', null)).toBe(0);
  });

  test('the psf rate is NOT put through the thousands shorthand', () => {
    // The whole bug: 20 -> 20000 -> ×area would be absurd.
    expect(parseRent('20 psf', 35000)).toBeLessThan(1_000_000);
  });

  test('unparseable input is 0, not NaN', () => {
    expect(parseRent(null)).toBe(0);
    expect(parseRent('ask')).toBe(0);
  });
});

describe('parseAreaSqft', () => {
  test('plain numbers', () => {
    expect(parseAreaSqft(3200)).toBe(3200);
    expect(parseAreaSqft('12,500')).toBe(12500);
  });

  test('rejects text that merely starts with a number', () => {
    // C-15's cell is "15R + Banquet"; it went live as area_sqft = 15.
    expect(parseAreaSqft('15R + Banquet')).toBeNull();
  });

  test('accepts a number with a unit suffix', () => {
    expect(parseAreaSqft('12000 sq ft')).toBe(12000);
    expect(parseAreaSqft('4000 sqft')).toBe(4000);
  });

  test('blank is null', () => {
    expect(parseAreaSqft(null)).toBeNull();
    expect(parseAreaSqft('')).toBeNull();
  });
});
