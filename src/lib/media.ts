import type { MediaSize } from './types';
export function mediaUrl(r2KeyBase: string, size: MediaSize): string {
  return `/media/${r2KeyBase}-${size}.webp`;
}
export function isAllowedReferer(referer: string | null, siteOrigin: string): boolean {
  if (!referer) return true;
  try { return new URL(referer).origin === siteOrigin; } catch { return false; }
}
