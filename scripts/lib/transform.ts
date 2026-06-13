import type { Property, Segment, Furnishing, Status, MediaSize } from '../../src/lib/types';

export function slugify(text: string, suffix?: number): string {
  const base = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return suffix == null ? base : `${base}-${String(suffix).padStart(2, '0')}`;
}

export function makeDisplayId(n: number): string { return `#${String(n).padStart(2, '0')}`; }

const toInt = (v: unknown) => parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10) || 0;

export function normalizeFurnishing(v: string): Furnishing {
  const s = v.toLowerCase();
  if (s.includes('semi')) return 'semi-furnished';
  if (s.includes('unfurnished') || s.includes('bare')) return 'unfurnished';
  return 'furnished';
}

export function normalizeSegment(typeOrTitle: string): Segment {
  return /office|shop|retail|commercial|showroom|warehouse/i.test(typeOrTitle) ? 'commercial' : 'residential';
}

export function normalizeStatus(v: string): Status {
  const s = (v || '').toLowerCase();
  if (s.includes('rent')) return 'rented';
  if (s.includes('hold')) return 'on-hold';
  return 'available';
}

export function rowToProperty(row: Record<string, any>, n: number): Property {
  const title = String(row.Title ?? '').trim();
  return {
    id: crypto.randomUUID(), display_id: makeDisplayId(n),
    segment: normalizeSegment(`${row.Type} ${title}`),
    bhk_type: row.BHK ? String(row.BHK).toUpperCase() : null,
    property_type: String(row.Type ?? 'apartment').toLowerCase(),
    rent_inr: toInt(row.Rent), area_sqft: row.Area ? toInt(row.Area) : null,
    furnishing: row.Furnishing ? normalizeFurnishing(String(row.Furnishing)) : null,
    status: normalizeStatus(String(row.Status ?? 'Available')),
    landmark: row.Landmark ? String(row.Landmark) : null,
    neighbourhood_slug: slugify(String(row.Neighbourhood ?? '')),
    map_url: row.MapUrl ? String(row.MapUrl) : null,
    description: row.Description ? String(row.Description) : null,
    slug: slugify(title, n), published: 1, created_at: new Date().toISOString(),
  };
}

export function r2KeyFor(slug: string, index: number, size: MediaSize): string {
  return `properties/${slug}/${index}-${size}.webp`;
}

export function coverAndOrder(files: string[]): { file: string; index: number; isCover: boolean }[] {
  const marked = files.filter((f) => /-cover\.[a-z]+$/i.test(f));
  const rest = files.filter((f) => !/-cover\.[a-z]+$/i.test(f)).sort();
  const ordered = [...marked.sort(), ...rest];
  return ordered.map((file, index) => ({ file, index, isCover: index === 0 }));
}
