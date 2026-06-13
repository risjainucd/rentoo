import type { D1Database } from '@cloudflare/workers-types';
import type { ListingFilters, Property, PropertyMedia, Neighbourhood } from './types';
import { buildListingsQuery, mapRowToCard } from './sql';

export function getDb(locals: App.Locals): D1Database { return locals.db; }

export async function listListings(db: D1Database, f: ListingFilters) {
  const q = buildListingsQuery(f);
  const [rows, count] = await db.batch([
    db.prepare(q.sql).bind(...q.params),
    db.prepare(q.countSql).bind(...q.countParams),
  ]);
  const items = (rows.results as Record<string, any>[]).map(mapRowToCard);
  const total = (count.results as { n: number }[])[0]?.n ?? 0;
  return { items, total };
}
export async function getListingBySlug(db: D1Database, slug: string) {
  const property = await db.prepare('SELECT * FROM properties WHERE slug = ? AND published = 1').bind(slug).first<Property>();
  if (!property) return null;
  const media = await db.prepare('SELECT * FROM property_media WHERE property_id = ? ORDER BY display_order ASC').bind(property.id).all<PropertyMedia>();
  const neighbourhood = await db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(property.neighbourhood_slug).first<Neighbourhood>();
  return { property, media: media.results ?? [], neighbourhood: neighbourhood! };
}
export async function listNeighbourhoods(db: D1Database) {
  const r = await db.prepare('SELECT * FROM neighbourhoods ORDER BY display_order ASC').all<Neighbourhood>();
  return r.results ?? [];
}
export async function getNeighbourhood(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(slug).first<Neighbourhood>();
}
export async function featuredListings(db: D1Database, limit: number) {
  const { sql, params } = buildListingsQuery({ perPage: limit, page: 1 });
  const r = await db.prepare(sql).bind(...params).all<Record<string, any>>();
  return (r.results ?? []).map(mapRowToCard);
}
