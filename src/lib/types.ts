export type Segment = 'residential' | 'commercial' | 'industrial';
export type Furnishing = 'furnished' | 'semi-furnished' | 'unfurnished';
export type Status = 'available' | 'rented' | 'on-hold';
export type MediaSize = 'card' | 'gallery' | 'full';

export interface Property {
  id: string; display_id: string; segment: Segment; bhk_type: string | null;
  property_type: string; rent_inr: number; area_sqft: number | null;
  furnishing: Furnishing | null; status: Status; landmark: string | null;
  neighbourhood_slug: string; map_url: string | null; description: string | null;
  slug: string; published: 0 | 1; created_at: string;
  views?: number; likes?: number; featured?: 0 | 1;
}
export interface PropertyMedia {
  id: string; property_id: string; kind: 'photo' | 'video'; r2_key: string;
  display_order: number; is_cover: 0 | 1; width: number | null; height: number | null; watermarked: 0 | 1;
}
export interface Neighbourhood {
  slug: string; name: string; display_order: number; cover_r2_key: string | null; short_description: string | null;
  major_slug?: string | null; major_area?: string | null;
}
// A rolled-up "major area" (e.g. Mansarovar) used for the main-area filter.
export interface MajorArea { slug: string; name: string; }
export interface ListingCard {
  slug: string; display_id: string; title: string; rent_inr: number; landmark: string | null;
  segment: Segment; bhk_type: string | null; furnishing: Furnishing | null; status: Status;
  neighbourhood_slug: string; cover_key: string | null; cover_w: number | null; cover_h: number | null;
  likes: number; featured: 0 | 1;
  photos?: string[]; // all photo base r2_keys, display order (photos[0] === cover_key)
}
export interface ListingFilters {
  segment?: Segment; neighbourhood?: string; area?: string; bhk?: string;
  furnishing?: Furnishing; minRent?: number; maxRent?: number;
  sort?: string;
  page?: number; perPage?: number;
}
