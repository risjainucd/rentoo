// Shared touch helpers for the photo carousels (listing cards and the detail gallery).

// Minimum horizontal travel before a drag counts as a swipe rather than a tap. Cards are wrapped
// in a stretched link, so anything below this must still open the listing.
export const SWIPE_MIN_PX = 40;

// Which way a finger moved, or null when the gesture belongs to something else. A drag that is
// not decisively horizontal is left alone so the page keeps scrolling under the carousel —
// ties go to the page, since stealing a vertical gesture is far more annoying than missing a
// sloppy horizontal one.
export function swipeDirection(dx: number, dy: number, minPx = SWIPE_MIN_PX): 'prev' | 'next' | null {
  if (Math.abs(dx) < minPx) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

// Which slide a horizontal scroll-snap track is showing. Clamped, because iOS reports negative
// and past-the-end offsets while the track rubber-bands, and slideWidth is 0 before layout.
export function slideIndexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (!(slideWidth > 0) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / slideWidth)));
}
