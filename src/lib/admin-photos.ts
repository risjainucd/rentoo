import type { MediaSize } from './types';

// Watermark constants mirrored from scripts/_watermark.mjs so client output matches the offline pipeline.
export const WORDMARK_FRAC = 0.6;
export const WHITE_OPACITY = 0.18;
export const SHADOW_OPACITY = 0.22;

export const RENDITIONS: { name: MediaSize; width: number; quality: number }[] = [
  { name: 'card', width: 600, quality: 0.72 },
  { name: 'gallery', width: 1200, quality: 0.8 },
  { name: 'full', width: 2000, quality: 0.82 },
];

// Never upscale: each rendition is min(target, source width). Mirrors sharp's withoutEnlargement.
export function renditionPlan(srcWidth: number): { name: MediaSize; width: number; quality: number }[] {
  return RENDITIONS.map((r) => ({ ...r, width: Math.min(r.width, srcWidth) }));
}

// Centered wordmark box at 0.6x image width (min 80px), clamped to fit within 92% of the image.
export function watermarkLayout(imgW: number, imgH: number, logoAspect: number): { w: number; h: number; left: number; top: number } {
  let w = Math.max(80, Math.round(imgW * WORDMARK_FRAC));
  let h = Math.round(w / logoAspect);
  const maxW = imgW * 0.92, maxH = imgH * 0.92;
  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { w, h, left: Math.round((imgW - w) / 2), top: Math.round((imgH - h) / 2) };
}

// Ordering invariant source of truth: display_order = index, cover = index 0.
export function normalizePhotoOrder(ids: string[]): { id: string; display_order: number; is_cover: 0 | 1 }[] {
  return ids.map((id, i) => ({ id, display_order: i, is_cover: i === 0 ? 1 : 0 }));
}

const SLUG_RE = /^[a-z0-9-]+$/;
export function photoBaseKey(slug: string, token: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`bad slug: ${slug}`);
  return `properties/${slug}/u-${token}`;
}

export function randomPhotoToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
