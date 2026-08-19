import { expect, test, describe } from 'vitest';
import layoutSrc from '../src/layouts/BaseLayout.astro?raw';
import manifestSrc from '../public/site.webmanifest?raw';

describe('icon declarations', () => {
  test('ships the surfaces an SVG favicon alone does not cover', () => {
    // iOS home screens reject SVG outright; Windows pinning and Safari <15.4 want the ICO.
    expect(layoutSrc).toMatch(/rel="icon"[^>]+href="\/favicon\.ico"[^>]+sizes="32x32"/);
    expect(layoutSrc).toMatch(/rel="icon"[^>]+type="image\/svg\+xml"/);
    expect(layoutSrc).toMatch(/rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/);
    expect(layoutSrc).toMatch(/rel="manifest"/);
  });
});

describe('web app manifest', () => {
  const manifest = JSON.parse(manifestSrc);

  test('is valid and names the app', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
  });

  test('keeps the maskable icon separate from the plain ones', () => {
    // "any maskable" on one file cannot be padded correctly for both: as a maskable it gets
    // cropped, and as an "any" icon the maskable padding makes the mark look shrunken.
    for (const icon of manifest.icons) {
      expect(icon.purpose.split(/\s+/).length, `"${icon.purpose}" serves two purposes`).toBe(1);
    }
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });
});

describe('link previews', () => {
  test('every share tag needed for a WhatsApp unfurl is present', () => {
    for (const tag of ['og:type', 'og:title', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) {
      expect(layoutSrc, `missing ${tag}`).toContain(`property="${tag}"`);
    }
    expect(layoutSrc).toContain('name="twitter:card"');
  });

  test('the image URL is absolute, since relative og:image does not unfurl', () => {
    expect(layoutSrc).toMatch(/ogImageUrl\s*=\s*new URL\(/);
    expect(layoutSrc).toMatch(/content=\{ogImageUrl\.href\}/);
  });
});
