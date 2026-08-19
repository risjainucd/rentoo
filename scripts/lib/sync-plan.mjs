// Pure planning for the Google Drive / Sheets -> Cloudflare sync. No I/O, so the decisions the
// sync makes can be tested without credentials.
//
// The sheet is the source of truth for listing FACTS, never for identity. import-excel.mjs mints
// crypto.randomUUID() ids and index-derived slugs, so it cannot be re-run — the sync matches on
// display_id ("#01"), which is the sheet's own Property ID, and leaves slugs alone forever after
// a listing is created. Slugs are live URLs.

/** Fields the sheet is allowed to change on an existing listing. */
export const MUTABLE_FIELDS = [
  'segment', 'bhk_type', 'property_type', 'rent_inr', 'area_sqft', 'furnishing',
  'status', 'landmark', 'neighbourhood_slug', 'map_url', 'description', 'published',
];

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
const key = (v) => String(v ?? '').trim();

// Natural order, so "2.jpg" sorts before "10.jpg" and the cover photo (index 0) is stable across
// runs. Sorting by plain string would silently re-cover a listing when a tenth photo is added.
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Diff the sheet against what is already in D1.
 * Returns { create, update, missing } — never a delete: a botched sheet edit or a Drive
 * permission blip must not be able to remove live listings.
 */
export function planListings(sheetRows, dbRows) {
  const bySheet = new Map();
  for (const row of sheetRows) {
    const id = key(row.display_id);
    if (!id) continue; // blank rows and spacer rows in the sheet
    if (bySheet.has(id)) throw new Error(`duplicate Property ID in the sheet: ${id}`);
    bySheet.set(id, { ...row, display_id: id });
  }
  const byDb = new Map(dbRows.map((r) => [key(r.display_id), r]));

  const create = [], update = [];
  for (const [id, row] of bySheet) {
    const existing = byDb.get(id);
    if (!existing) { create.push(row); continue; }
    const changes = {};
    for (const field of MUTABLE_FIELDS) {
      if (!(field in row)) continue;             // sheet does not carry this column
      const from = existing[field] ?? null;
      const to = row[field] ?? null;
      if (from !== to) changes[field] = [from, to];
    }
    if (Object.keys(changes).length) update.push({ display_id: id, slug: existing.slug, changes });
  }

  const missing = [...byDb.entries()].filter(([id]) => !bySheet.has(id)).map(([, r]) => r);
  return { create, update, missing };
}

/**
 * Which of a listing's Drive files still need watermarking and uploading.
 * `stored` is the set of source filenames already represented in property_media.
 */
export function planPhotos(slug, driveFiles, stored) {
  const images = driveFiles.filter((f) => IMAGE_RE.test(f)).sort(natural);
  const have = new Set(stored);
  return {
    slug,
    upload: images.filter((f) => !have.has(f)),
    // Reported so a photo pulled from Drive is visible, but never removed from R2 — the object
    // may still be referenced by a listing that is live right now.
    missing: stored.filter((f) => !images.includes(f)),
  };
}
