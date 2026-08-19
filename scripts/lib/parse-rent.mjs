// Shared spreadsheet money/area parsing. Lives here because two importers need identical
// behaviour: a listing's rent must not depend on which script happened to create it.

// "20 psf", "15psf", "20 per sqft", "20/sq ft" — a per-square-foot RATE, not a monthly rent.
const PSF_RE = /(?:p\.?\s?s\.?\s?f|per\s*sq|\/\s*sq|sq\.?\s*(?:ft|feet))/i;
// A pure number, optionally comma-grouped/decimal, optionally followed only by an area unit.
const AREA_RE = /^\s*([\d][\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*(?:ft|feet)?|sqft)?\s*$/i;

/**
 * Monthly rent in rupees.
 * Pass `areaSqft` so per-square-foot quotes can be converted; without it a psf quote returns 0,
 * which leaves the listing unpublished — recoverable, unlike a figure that is 1000x wrong.
 * @param {unknown} v
 * @param {number|null|undefined} [areaSqft]
 * @returns {number}
 */
export function parseRent(v, areaSqft = null) {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.round(v) > 0 && Math.round(v) < 1000 ? Math.round(v) * 1000 : Math.round(v);

  const s = String(v).toLowerCase();
  const m = s.match(/([\d][\d.,]*)\s*(k|l|lakh|lac)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return 0;

  if (PSF_RE.test(s)) {
    // A rate is a real figure — never run it through the thousands shorthand below.
    const area = Number(areaSqft);
    if (!Number.isFinite(area) || area <= 0) return 0;
    return Math.round(n * area);
  }

  if (m[2] === 'k') n *= 1000;
  else if (m[2] && /l/.test(m[2])) n *= 100000;
  n = Math.round(n);
  // No listing rents below ₹1000/mo; bare small values are shorthand thousands ("28" -> 28000).
  return n > 0 && n < 1000 ? n * 1000 : n;
}

/**
 * Area in square feet, or null.
 * @param {unknown} v
 * @returns {number|null} Only accepts a cell that is a number (optionally with an area
 * unit) — "15R + Banquet" is a description, and taking its leading 15 published a banquet hall
 * as 15 sq ft.
 */
export function parseAreaSqft(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const m = String(v).match(AREA_RE);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
