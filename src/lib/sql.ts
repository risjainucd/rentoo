import type { ListingFilters, ListingCard, Segment, Furnishing } from './types';

const SELECT_CARD = `
  SELECT p.slug, p.display_id, p.segment, p.bhk_type, p.property_type, p.rent_inr, p.landmark,
         p.furnishing, p.status, p.neighbourhood_slug,
         pm.r2_key AS cover_key, pm.width AS cover_w, pm.height AS cover_h
  FROM properties p
  LEFT JOIN property_media pm ON pm.property_id = p.id AND pm.is_cover = 1`;

export function buildListingsQuery(f: ListingFilters): { sql: string; params: unknown[]; countSql: string; countParams: unknown[] } {
  const where: string[] = ['p.published = 1'];
  const params: unknown[] = [];
  if (f.segment)        { where.push('p.segment = ?');            params.push(f.segment); }
  if (f.neighbourhood)  { where.push('p.neighbourhood_slug = ?'); params.push(f.neighbourhood); }
  if (f.bhk)            { where.push('p.bhk_type = ?');           params.push(f.bhk); }
  if (f.furnishing)     { where.push('p.furnishing = ?');         params.push(f.furnishing); }
  if (f.minRent != null){ where.push('p.rent_inr >= ?');          params.push(f.minRent); }
  if (f.maxRent != null){ where.push('p.rent_inr <= ?');          params.push(f.maxRent); }
  const whereSql = where.join(' AND ');
  const perPage = f.perPage ?? 12;
  const offset = perPage * ((f.page ?? 1) - 1);
  const sql = `${SELECT_CARD} WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM properties p WHERE ${whereSql}`;
  return { sql, params: [...params, perPage, offset], countSql, countParams: [...params] };
}
export function mapRowToCard(r: Record<string, any>): ListingCard {
  const title = [r.bhk_type, r.property_type].filter(Boolean).join(' ');
  return {
    slug: r.slug, display_id: r.display_id, title, rent_inr: r.rent_inr, landmark: r.landmark,
    segment: r.segment, bhk_type: r.bhk_type, furnishing: r.furnishing, status: r.status,
    neighbourhood_slug: r.neighbourhood_slug, cover_key: r.cover_key, cover_w: r.cover_w, cover_h: r.cover_h,
    photos: [],
  };
}
export function parseListingFilters(url: URL): ListingFilters {
  const q = url.searchParams;
  const num = (k: string) => { const v = q.get(k); const n = v == null ? NaN : parseInt(v, 10); return Number.isFinite(n) ? n : undefined; };
  const str = (k: string) => q.get(k) || undefined;
  const f: ListingFilters = {};
  if (str('segment'))       f.segment = str('segment') as Segment;
  if (str('neighbourhood')) f.neighbourhood = str('neighbourhood');
  if (str('bhk'))           f.bhk = str('bhk');
  if (str('furnishing'))    f.furnishing = str('furnishing') as Furnishing;
  if (num('minRent') !== undefined) f.minRent = num('minRent');
  if (num('maxRent') !== undefined) f.maxRent = num('maxRent');
  if (num('page') !== undefined)    f.page = num('page');
  return f;
}
