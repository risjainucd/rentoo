import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Approximate centres of Jaipur's major areas (lat, lng) for the fallback map.
const AREA_COORDS: Record<string, [number, number]> = {
  mansarovar: [26.8506, 75.7628],
  'vaishali-nagar': [26.9120, 75.7420],
  'malviya-nagar': [26.8550, 75.8070],
  'c-scheme': [26.9070, 75.7960],
  jagatpura: [26.8260, 75.8470],
  'vidhyadhar-nagar': [26.9580, 75.7780],
  'raja-park': [26.8920, 75.8270],
  'tonk-road': [26.8690, 75.8020],
  'sodala-ajmer-road': [26.9060, 75.7660],
  gopalpura: [26.8600, 75.7890],
  durgapura: [26.8470, 75.7920],
  'bani-park': [26.9330, 75.7990],
  'civil-lines': [26.9080, 75.7830],
  sitapura: [26.7680, 75.8470],
  'pratap-nagar': [26.7760, 75.8300],
  'bapu-nagar': [26.8960, 75.8140],
  'mahesh-nagar': [26.8770, 75.7990],
};
const JAIPUR_CENTRE: [number, number] = [26.9124, 75.7873];

// Map embed for a listing's Location section.
// - If the listing has an exact `map_url` (a *framable* embed URL — e.g. Google Maps
//   "Share → Embed a map" `https://www.google.com/maps/embed?pb=…`), use it as-is:
//   that's the per-listing pin. Wiring in an exact location later = just set `map_url`.
// - Otherwise fall back to a keyless OpenStreetMap embed centred on the listing's
//   major area, so every listing always shows a real map (labelled "approximate").
export function mapEmbed(opts: {
  mapUrl?: string | null;
  majorSlug?: string | null;
}): { src: string; exact: boolean } {
  if (opts.mapUrl) return { src: opts.mapUrl, exact: true };
  const [lat, lng] = (opts.majorSlug && AREA_COORDS[opts.majorSlug]) || JAIPUR_CENTRE;
  const dLat = 0.018, dLng = 0.028;
  const bbox = `${(lng - dLng).toFixed(4)},${(lat - dLat).toFixed(4)},${(lng + dLng).toFixed(4)},${(lat + dLat).toFixed(4)}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  return { src, exact: false };
}

// `property_type` and `furnishing` are stored lowercase ("office space", "furnished").
// Casing them in CSS only fixes what is rendered — page titles, meta descriptions and
// alt text stay lowercase, and those are what a WhatsApp link preview shows.
export function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Landmarks are entered with their own locative word about half the time ("near diona",
// "Opp jpi pre school"), so only prefix when one is missing — otherwise a title reads
// "office space near near diona".
const LOCATIVE = /^(near|nr\.?|opp\.?|opposite|behind|beside|next\s+to|in\s+front)\b/i;
export function withLocative(landmark?: string | null): string | null {
  const s = landmark?.trim();
  if (!s) return null;
  return LOCATIVE.test(s) ? s : `near ${s}`;
}

// Rent per sq ft is often below ₹1 on large industrial floors, where Math.round() prints
// "₹1" for ₹0.57 and "₹0" — falsy — for anything under ₹0.50.
export function perSqftLabel(rentInr: number, areaSqft?: number | null): string | null {
  if (!areaSqft) return null;
  const rate = rentInr / areaSqft;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return `₹${rate < 10 ? rate.toFixed(1) : Math.round(rate)}/sqft`;
}
