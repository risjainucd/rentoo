import type { ListingFilters, ListingCard, Segment, Furnishing } from './types';

const SELECT_CARD = `
  SELECT p.slug, p.display_id, p.segment, p.bhk_type, p.property_type, p.rent_inr, p.landmark,
         p.furnishing, p.status, p.neighbourhood_slug, p.likes, p.featured,
         pm.r2_key AS cover_key, pm.width AS cover_w, pm.height AS cover_h
  FROM properties p
  LEFT JOIN property_media pm ON pm.property_id = p.id AND pm.is_cover = 1`;

// Sort options exposed in the UI. Keys match the ?sort= query param.
function orderByFor(sort?: string): string {
  switch (sort) {
    case 'featured':    return 'p.featured DESC, p.created_at DESC';
    case 'most-viewed': return 'p.views DESC, p.created_at DESC';
    case 'most-liked':  return 'p.likes DESC, p.created_at DESC';
    case 'budget':      return 'p.rent_inr ASC, p.created_at DESC';
    default:            return 'p.created_at DESC';
  }
}

export function buildListingsQuery(f: ListingFilters): { sql: string; params: unknown[]; countSql: string; countParams: unknown[] } {
  // Rented-out listings are hidden from the public site (kept in DB; flip status
  // back to 'available' to re-list). Available + on-hold remain visible.
  const where: string[] = ['p.published = 1', "p.status <> 'rented'"];
  const params: unknown[] = [];
  if (f.segment)        { where.push('p.segment = ?');            params.push(f.segment); }
  if (f.area)           { where.push('p.neighbourhood_slug IN (SELECT slug FROM neighbourhoods WHERE major_slug = ?)'); params.push(f.area); }
  if (f.neighbourhood)  { where.push('p.neighbourhood_slug = ?'); params.push(f.neighbourhood); }
  if (f.bhk)            { where.push('p.bhk_type = ?');           params.push(f.bhk); }
  if (f.furnishing)     { where.push('p.furnishing = ?');         params.push(f.furnishing); }
  if (f.minRent != null){ where.push('p.rent_inr >= ?');          params.push(f.minRent); }
  if (f.maxRent != null){ where.push('p.rent_inr <= ?');          params.push(f.maxRent); }
  const whereSql = where.join(' AND ');
  const perPage = f.perPage ?? 12;
  const offset = perPage * ((f.page ?? 1) - 1);
  const sql = `${SELECT_CARD} WHERE ${whereSql} ORDER BY ${orderByFor(f.sort)} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM properties p WHERE ${whereSql}`;
  return { sql, params: [...params, perPage, offset], countSql, countParams: [...params] };
}
export function mapRowToCard(r: Record<string, any>): ListingCard {
  const title = [r.bhk_type, r.property_type].filter(Boolean).join(' ');
  return {
    slug: r.slug, display_id: r.display_id, title, rent_inr: r.rent_inr, landmark: r.landmark,
    segment: r.segment, bhk_type: r.bhk_type, furnishing: r.furnishing, status: r.status,
    neighbourhood_slug: r.neighbourhood_slug, cover_key: r.cover_key, cover_w: r.cover_w, cover_h: r.cover_h,
    likes: r.likes ?? 0, featured: (r.featured ? 1 : 0) as 0 | 1,
    photos: [],
  };
}
export function parseListingFilters(url: URL): ListingFilters {
  const q = url.searchParams;
  const num = (k: string) => { const v = q.get(k); const n = v == null ? NaN : parseInt(v, 10); return Number.isFinite(n) ? n : undefined; };
  const str = (k: string) => q.get(k) || undefined;
  const f: ListingFilters = {};
  if (str('segment'))       f.segment = str('segment') as Segment;
  if (str('area'))          f.area = str('area');
  if (str('neighbourhood')) f.neighbourhood = str('neighbourhood');
  if (str('bhk'))           f.bhk = str('bhk');
  if (str('sort'))          f.sort = str('sort');
  if (str('furnishing'))    f.furnishing = str('furnishing') as Furnishing;
  if (num('minRent') !== undefined) f.minRent = num('minRent');
  if (num('maxRent') !== undefined) f.maxRent = num('maxRent');
  if (num('page') !== undefined)    f.page = num('page');
  return f;
}
