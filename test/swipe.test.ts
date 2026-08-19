import { expect, test, describe } from 'vitest';
import { swipeDirection, slideIndexFromScroll, SWIPE_MIN_PX } from '../src/lib/swipe';

// Photo carousels are inside a vertically scrolling page, and each listing card is wrapped in a
// stretched link. So a touch has three plausible meanings — scroll the page, tap through to the
// listing, or change photo — and only a clearly horizontal drag is the last one.

describe('swipeDirection', () => {
  test('a clear leftward drag advances', () => {
    expect(swipeDirection(-80, 5)).toBe('next');
  });
  test('a clear rightward drag goes back', () => {
    expect(swipeDirection(80, 5)).toBe('prev');
  });
  test('a short drag is a tap, not a swipe', () => {
    // Below the threshold the card link should still open the listing.
    expect(swipeDirection(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
    expect(swipeDirection(0, 0)).toBeNull();
  });
  test('a mostly-vertical drag is page scrolling, not a swipe', () => {
    expect(swipeDirection(-60, 200)).toBeNull();
    expect(swipeDirection(60, -200)).toBeNull();
  });
  test('an ambiguous 45-degree drag scrolls the page rather than stealing the gesture', () => {
    expect(swipeDirection(-80, 80)).toBeNull();
  });
  test('a long diagonal still counts when it is decisively horizontal', () => {
    expect(swipeDirection(-120, 40)).toBe('next');
  });
});

describe('slideIndexFromScroll', () => {
  test('reports the slide nearest the current offset', () => {
    expect(slideIndexFromScroll(0, 300, 4)).toBe(0);
    expect(slideIndexFromScroll(300, 300, 4)).toBe(1);
    expect(slideIndexFromScroll(900, 300, 4)).toBe(3);
  });
  test('snaps to the nearer slide mid-drag', () => {
    expect(slideIndexFromScroll(140, 300, 4)).toBe(0);
    expect(slideIndexFromScroll(160, 300, 4)).toBe(1);
  });
  test('clamps rubber-band overscroll to a real slide', () => {
    // iOS reports negative and past-the-end offsets while the track bounces.
    expect(slideIndexFromScroll(-50, 300, 4)).toBe(0);
    expect(slideIndexFromScroll(1400, 300, 4)).toBe(3);
  });
  test('survives being measured before layout', () => {
    expect(slideIndexFromScroll(0, 0, 4)).toBe(0);
    expect(slideIndexFromScroll(100, 300, 0)).toBe(0);
  });
});

// The card carousel's listeners must sit on the card, not on the photo frame. A stretched
// <a class="card-link"> is painted over the photo, so the <a> is the touch target and
// .card-image is not on the event's propagation path — listeners bound to the frame never fire
// for a real finger. This was not caught by dispatching events at .card-image directly, which is
// why it is pinned here.
import cardSrc from '../src/components/PropertyCard.astro?raw';

describe('PropertyCard swipe wiring', () => {
  const touchBindings = [...cardSrc.matchAll(/(\w+)\.addEventListener\(\s*'(touchstart|touchend)'/g)];

  test('binds touch events, and binds them to the card root', () => {
    expect(touchBindings.map((m) => m[2]).sort()).toEqual(['touchend', 'touchstart']);
    for (const [, target, evt] of touchBindings) {
      expect(target, `'${evt}' is bound to \`${target}\`, which the stretched link covers`).toBe('card');
    }
  });

  test('only gestures starting over the photo count', () => {
    // Otherwise a horizontal drag across the card's text would flip photos.
    expect(cardSrc).toMatch(/frame\.getBoundingClientRect\(\)/);
    expect(cardSrc).toMatch(/fromPhoto/);
  });

  test('a swipe cancels the click, so it cannot open the listing', () => {
    expect(cardSrc).toMatch(/card\.addEventListener\(\s*'click'[\s\S]{0,200}?preventDefault/);
  });
});
