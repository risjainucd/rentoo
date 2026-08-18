import type { D1Database } from '@cloudflare/workers-types';
import type { ListingFilters, ListingCard, Property, PropertyMedia, Neighbourhood } from './types';
import { buildListingsQuery, mapRowToCard } from './sql';
import { normalizePhotoOrder } from './admin-photos';

export function getDb(locals: App.Locals): D1Database { return locals.db; }

// Attach each card's full ordered photo list (base r2_keys) in one batched query.
// photos[0] === cover_key (cover is display_order 0). Mutates + returns the cards.
async function attachPhotos(db: D1Database, cards: ListingCard[]) {
  if (!cards.length) return cards;
  const slugs = cards.map((c) => c.slug);
  const placeholders = slugs.map(() => '?').join(',');
  const r = await db.prepare(
    `SELECT p.slug AS slug, pm.r2_key AS key
     FROM property_media pm JOIN properties p ON p.id = pm.property_id
     WHERE p.slug IN (${placeholders}) AND pm.kind = 'photo'
     ORDER BY pm.display_order ASC`
  ).bind(...slugs).all<{ slug: string; key: string }>();
  const bySlug = new Map<string, string[]>();
  for (const row of r.results ?? []) {
    const arr = bySlug.get(row.slug) ?? [];
    arr.push(row.key);
    bySlug.set(row.slug, arr);
  }
  for (const c of cards) c.photos = bySlug.get(c.slug) ?? (c.cover_key ? [c.cover_key] : []);
  return cards;
}

export async function listListings(db: D1Database, f: ListingFilters) {
  const q = buildListingsQuery(f);
  const [rows, count] = await db.batch([
    db.prepare(q.sql).bind(...q.params),
    db.prepare(q.countSql).bind(...q.countParams),
  ]);
  const items = (rows.results as Record<string, any>[]).map(mapRowToCard);
  await attachPhotos(db, items);
  const total = (count.results as { n: number }[])[0]?.n ?? 0;
  return { items, total };
}
export async function getListingBySlug(db: D1Database, slug: string) {
  const property = await db.prepare("SELECT * FROM properties WHERE slug = ? AND published = 1 AND status <> 'rented'").bind(slug).first<Property>();
  if (!property) return null;
  const media = await db.prepare('SELECT * FROM property_media WHERE property_id = ? ORDER BY display_order ASC').bind(property.id).all<PropertyMedia>();
  const neighbourhood = await db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(property.neighbourhood_slug).first<Neighbourhood>();
  return { property, media: media.results ?? [], neighbourhood: neighbourhood! };
}
export async function listNeighbourhoods(db: D1Database) {
  const r = await db.prepare('SELECT * FROM neighbourhoods ORDER BY display_order ASC').all<Neighbourhood>();
  return r.results ?? [];
}
// Distinct "major areas" that have at least one published listing — the main-area
// filter options. Optionally scoped to a segment so each section shows only its areas.
export async function listMajorAreas(db: D1Database, segment?: string) {
  const sql = `SELECT n.major_slug AS slug, n.major_area AS name, COUNT(*) AS n
     FROM neighbourhoods n JOIN properties p ON p.neighbourhood_slug = n.slug
     WHERE p.published = 1 AND p.status <> 'rented' AND n.major_slug IS NOT NULL${segment ? ' AND p.segment = ?' : ''}
     GROUP BY n.major_slug, n.major_area
     ORDER BY n.major_area ASC`;
  const stmt = segment ? db.prepare(sql).bind(segment) : db.prepare(sql);
  const r = await stmt.all<{ slug: string; name: string; n: number }>();
  return (r.results ?? []).map((x) => ({ slug: x.slug, name: x.name }));
}
// The Area filter options, plus the currently selected area when it has no live listings —
// rented out, or none in this segment (most areas have no commercial/industrial stock). Base UI
// resolves a Select's label only from the items it is given, so without this the trigger renders
// the raw slug ("mahesh-nagar"). The name always comes from the DB: slugs are not reversible
// ("sodala-ajmer-road" is "Sodala / Ajmer Road"). Returned unchanged when the slug names no
// area at all — the caller treats that as an unknown filter and drops it.
export async function listMajorAreasIncluding(db: D1Database, segment?: string, selected?: string) {
  const areas = await listMajorAreas(db, segment);
  if (!selected || areas.some((a) => a.slug === selected)) return areas;
  const row = await db.prepare(
    'SELECT major_area AS name FROM neighbourhoods WHERE major_slug = ? AND major_area IS NOT NULL LIMIT 1',
  ).bind(selected).first<{ name: string }>();
  if (!row) return areas;
  // Splice rather than re-sort: `areas` is already ordered by SQLite's collation, and inserting
  // leaves that order untouched even where JS string comparison would disagree with it.
  const entry = { slug: selected, name: row.name };
  const at = areas.findIndex((a) => a.name > entry.name);
  return at === -1 ? [...areas, entry] : [...areas.slice(0, at), entry, ...areas.slice(at)];
}
export async function getNeighbourhood(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(slug).first<Neighbourhood>();
}
// ── Admin (behind Cloudflare Access) ──
export async function listAllForAdmin(db: D1Database) {
  const r = await db.prepare(
    `SELECT p.slug, p.display_id, p.segment, p.bhk_type, p.property_type, p.rent_inr,
            p.status, p.furnishing, p.published, p.featured, p.neighbourhood_slug,
            (SELECT COUNT(*) FROM property_media m WHERE m.property_id=p.id AND m.kind='photo') AS photos,
            (SELECT COUNT(*) FROM property_media m WHERE m.property_id=p.id AND m.kind='video') AS videos
     FROM properties p ORDER BY p.created_at DESC`,
  ).all<Record<string, any>>();
  return r.results ?? [];
}

export async function getAnyListingBySlug(db: D1Database, slug: string) {
  const property = await db.prepare('SELECT * FROM properties WHERE slug = ?').bind(slug).first<Property>();
  if (!property) return null;
  const media = await db.prepare('SELECT * FROM property_media WHERE property_id = ? ORDER BY kind, display_order ASC').bind(property.id).all<PropertyMedia>();
  const neighbourhood = await db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(property.neighbourhood_slug).first<Neighbourhood>();
  return { property, media: media.results ?? [], neighbourhood };
}

// Listings created here get their own "A-NN" series. The Excel importer takes display_id
// straight from the spreadsheet ("#01".."#118", "##01".., "C-1".."C-19") and upserts on slug
// only, so minting another "#NN" here would collide with a future spreadsheet row on
// UNIQUE(display_id) and abort the whole re-import. Scanning only our own series also avoids
// the old /(\d+)/ scan, which flattened three unrelated id series into one number space.
export async function suggestNextDisplayId(db: D1Database): Promise<string> {
  const r = await db.prepare("SELECT display_id FROM properties WHERE display_id LIKE 'A-%'").all<{ display_id: string }>();
  let max = 0;
  for (const row of r.results ?? []) {
    const m = /^A-(\d+)$/.exec(row.display_id ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'A-' + String(max + 1).padStart(2, '0');
}

async function slugTaken(db: D1Database, slug: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM properties WHERE slug = ?').bind(slug).first();
  return row != null;
}
// Slugs that collide with a static admin route. Astro resolves /admin/new to the static
// new-listing page, so a listing slugged "new" could never be opened in the editor.
const RESERVED_SLUGS = new Set(['new']);
// A slug not already in use: `base`, else base-2, base-3, … Falls back to 'listing' if empty.
export async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  const clean = base || 'listing';
  let slug = clean;
  for (let i = 2; RESERVED_SLUGS.has(slug) || (await slugTaken(db, slug)); i++) slug = `${clean}-${i}`;
  return slug;
}

export interface NewListingInput {
  display_id: string; segment: string; bhk_type: string | null; property_type: string;
  rent_inr: number; area_sqft: number | null; furnishing: string | null; status: string;
  landmark: string | null; neighbourhood_slug: string; map_url: string | null;
  description: string | null; slug: string; published: 0 | 1; featured: 0 | 1;
}
// Insert a new listing. Caller resolves display_id (suggestNextDisplayId) and a unique slug
// (uniqueSlug) first, and validates segment/status/furnishing/neighbourhood.
export async function createListing(db: D1Database, f: NewListingInput): Promise<void> {
  await db.prepare(
    `INSERT INTO properties (id, display_id, segment, bhk_type, property_type, rent_inr, area_sqft,
       furnishing, status, landmark, neighbourhood_slug, map_url, description, slug, published, featured)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), f.display_id, f.segment, f.bhk_type, f.property_type, f.rent_inr, f.area_sqft,
    f.furnishing, f.status, f.landmark, f.neighbourhood_slug, f.map_url, f.description, f.slug, f.published, f.featured,
  ).run();
}

// segment, neighbourhood_slug and area_sqft are editable here too: they are only ever set at
// create time, and without this a mis-picked segment or area could never be corrected from the
// admin UI. (slug stays immutable — it is the public URL and the R2 media path prefix.)
export interface AdminListingUpdate {
  rent_inr: number; status: string; furnishing: string | null; bhk_type: string | null;
  property_type: string; landmark: string | null; description: string | null;
  map_url: string | null; featured: 0 | 1; published: 0 | 1;
  segment: string; neighbourhood_slug: string; area_sqft: number | null;
}
export async function updateListingFields(db: D1Database, slug: string, f: AdminListingUpdate) {
  await db.prepare(
    `UPDATE properties SET rent_inr=?, status=?, furnishing=?, bhk_type=?, property_type=?,
            landmark=?, description=?, map_url=?, featured=?, published=?,
            segment=?, neighbourhood_slug=?, area_sqft=? WHERE slug=?`,
  ).bind(
    f.rent_inr, f.status, f.furnishing, f.bhk_type, f.property_type, f.landmark, f.description,
    f.map_url, f.featured, f.published, f.segment, f.neighbourhood_slug, f.area_sqft, slug,
  ).run();
}

// Set which photo is the cover (and make it lead the gallery: display_order 0).
export async function setCover(db: D1Database, slug: string, mediaId: string) {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return;
  const chosen = await db.prepare("SELECT id, display_order FROM property_media WHERE id=? AND property_id=? AND kind='photo'").bind(mediaId, prop.id).first<{ id: string; display_order: number }>();
  if (!chosen) return;
  const oldCover = await db.prepare("SELECT id, display_order FROM property_media WHERE property_id=? AND kind='photo' AND is_cover=1").bind(prop.id).first<{ id: string; display_order: number }>();
  const stmts = [
    db.prepare("UPDATE property_media SET is_cover=0 WHERE property_id=? AND kind='photo'").bind(prop.id),
    db.prepare('UPDATE property_media SET is_cover=1, display_order=0 WHERE id=?').bind(mediaId),
  ];
  // Bump the previous cover into the chosen photo's old slot so display_order stays unique-ish.
  if (oldCover && oldCover.id !== mediaId) {
    stmts.push(db.prepare('UPDATE property_media SET display_order=? WHERE id=?').bind(chosen.display_order || 1, oldCover.id));
  }
  await db.batch(stmts);
}

// Insert a photo at the end of the listing's photo order. The first photo (display_order 0)
// becomes the cover, so the "exactly one is_cover=1 when >=1 photo" invariant always holds.
export async function addPhoto(
  db: D1Database, slug: string, r2_key: string, width: number | null, height: number | null,
): Promise<PropertyMedia | null> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return null;
  const next = await db
    .prepare("SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM property_media WHERE property_id=? AND kind='photo'")
    .bind(prop.id).first<{ n: number }>();
  const display_order = next?.n ?? 0;
  const is_cover: 0 | 1 = display_order === 0 ? 1 : 0;
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO property_media (id, property_id, kind, r2_key, display_order, is_cover, width, height, watermarked) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, 1)",
  ).bind(id, prop.id, r2_key, display_order, is_cover, width, height).run();
  return { id, property_id: prop.id, kind: 'photo', r2_key, display_order, is_cover, width, height, watermarked: 1 };
}

// Apply an explicit order (array index = display_order; index 0 = cover). Ignores ids not on this
// listing, and appends any owned photos the caller omitted (keeping their current order) so the
// FULL set is always renormalized — a partial list can never leave stale/duplicate display_order.
export async function reorderPhotos(db: D1Database, slug: string, ids: string[]): Promise<void> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return;
  const owned = await db.prepare("SELECT id FROM property_media WHERE property_id=? AND kind='photo' ORDER BY display_order ASC").bind(prop.id).all<{ id: string }>();
  const ownedIds = (owned.results ?? []).map((r) => r.id);
  const valid = new Set(ownedIds);
  const requested = ids.filter((i) => valid.has(i));
  const seen = new Set(requested);
  const full = [...requested, ...ownedIds.filter((i) => !seen.has(i))];
  const plan = normalizePhotoOrder(full);
  if (!plan.length) return;
  await db.batch(plan.map((p) =>
    db.prepare('UPDATE property_media SET display_order=?, is_cover=? WHERE id=? AND property_id=?').bind(p.display_order, p.is_cover, p.id, prop.id),
  ));
}

// Soft delete: remove the row only (R2 objects retained). The DELETE and the renormalize run in
// ONE atomic db.batch, so a failure can never leave display_order gaps or a coverless listing.
export async function deletePhoto(db: D1Database, slug: string, id: string): Promise<void> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return;
  const all = await db.prepare("SELECT id FROM property_media WHERE property_id=? AND kind='photo' ORDER BY display_order ASC").bind(prop.id).all<{ id: string }>();
  const remaining = (all.results ?? []).map((r) => r.id).filter((x) => x !== id);
  const plan = normalizePhotoOrder(remaining);
  const stmts = [db.prepare("DELETE FROM property_media WHERE id=? AND property_id=? AND kind='photo'").bind(id, prop.id)];
  for (const p of plan) {
    stmts.push(db.prepare('UPDATE property_media SET display_order=?, is_cover=? WHERE id=?').bind(p.display_order, p.is_cover, p.id));
  }
  await db.batch(stmts);
}

export async function featuredListings(db: D1Database, limit: number) {
  const { sql, params } = buildListingsQuery({ perPage: limit, page: 1 });
  const r = await db.prepare(sql).bind(...params).all<Record<string, any>>();
  const cards = (r.results ?? []).map(mapRowToCard);
  await attachPhotos(db, cards);
  return cards;
}

// The single admin-flagged listing to spotlight on the home page. Uses the existing
// 'featured' sort (p.featured DESC, p.created_at DESC) + LIMIT 1 and the shared WHERE
// (published = 1 AND status <> 'rented'), so an unpublished/rented flagged listing never
// surfaces. Returns null when nothing is flagged: with no featured=1 rows the top row
// comes back featured:0, which the guard rejects — so the home page renders no hero.
export async function getFeaturedListing(db: D1Database): Promise<ListingCard | null> {
  const { sql, params } = buildListingsQuery({ sort: 'featured', perPage: 1, page: 1 });
  const r = await db.prepare(sql).bind(...params).all<Record<string, any>>();
  const card = (r.results ?? []).map(mapRowToCard)[0];
  if (!card || card.featured !== 1) return null;
  await attachPhotos(db, [card]);
  return card;
}
