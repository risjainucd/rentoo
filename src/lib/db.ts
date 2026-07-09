import type { D1Database } from '@cloudflare/workers-types';
import type { ListingFilters, ListingCard, Property, PropertyMedia, Neighbourhood } from './types';
import { buildListingsQuery, mapRowToCard } from './sql';

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
export async function getNeighbourhood(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(slug).first<Neighbourhood>();
}
export async function featuredListings(db: D1Database, limit: number) {
  const { sql, params } = buildListingsQuery({ perPage: limit, page: 1 });
  const r = await db.prepare(sql).bind(...params).all<Record<string, any>>();
  const cards = (r.results ?? []).map(mapRowToCard);
  await attachPhotos(db, cards);
  return cards;
}
