import { expect, test, describe } from 'vitest';
// Read as text via Vite's ?raw, matching test/filter-bar-selects.test.ts — these are
// source-level invariants, and it keeps the suite free of node type definitions.
import wordmarkSvg from '../public/Rentoo.svg?raw';
import iconSvg from '../public/Rentooicon.svg?raw';
import headerSrc from '../src/components/SiteHeader.astro?raw';
import layoutSrc from '../src/layouts/BaseLayout.astro?raw';

// Both logo assets were exported on an oversized canvas with the artwork floating in the middle
// and no viewBox: the wordmark's ink was 441x81 inside 666x375, the icon's 274x279 inside
// 500x500. Sized by height in CSS, that padding shrinks what you actually see — the header
// wordmark rendered about 10px tall in a 46px slot, and the favicon about 9px in a 16px tab.
// A viewBox cropped to the artwork is what makes the declared size mean the visible size.

const attr = (svg: string, name: string) => svg.match(new RegExp(`<svg[^>]*\\s${name}="([^"]+)"`))?.[1];
function box(svg: string) {
  const vb = attr(svg, 'viewBox');
  if (!vb) return null;
  const [x, y, w, h] = vb.trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

describe.each([
  ['Rentoo.svg (wordmark)', wordmarkSvg],
  ['Rentooicon.svg (icon)', iconSvg],
])('%s', (_name, svg) => {

  test('declares a viewBox', () => {
    expect(box(svg)).not.toBeNull();
  });

  test('its declared width/height match the viewBox, so the intrinsic size is the artwork', () => {
    const b = box(svg)!;
    expect(Number(attr(svg, 'width'))).toBe(b.w);
    expect(Number(attr(svg, 'height'))).toBe(b.h);
  });

  test('is cropped, not the original padded export canvas', () => {
    const b = box(svg)!;
    expect(b.w, 'still 666/500 wide — canvas was not cropped').toBeLessThan(600);
    expect(b.x + b.y, 'viewBox origin is 0 0 — artwork still floats in a padded canvas').toBeGreaterThan(0);
  });
});

describe('header wordmark', () => {
  const svg = wordmarkSvg;
  const img = headerSrc.match(/<img[^>]*Rentoo\.svg[^>]*>/)![0];

  test('the <img> width/height match the asset ratio, so nothing reflows on load', () => {
    const b = box(svg)!;
    const ratio = Number(img.match(/width="(\d+)"/)![1]) / Number(img.match(/height="(\d+)"/)![1]);
    expect(ratio).toBeCloseTo(b.w / b.h, 2);
  });

  test('the wordmark is wide, not the old near-square padded canvas', () => {
    const b = box(svg)!;
    expect(b.w / b.h).toBeGreaterThan(4); // the padded canvas was 1.78
  });
});

describe('favicon', () => {
  test('points at the cropped icon so the mark fills a 16px tab', () => {
    expect(layoutSrc).toMatch(/<link[^>]+rel="icon"[^>]+href="\/Rentooicon\.svg"/);
  });
});
