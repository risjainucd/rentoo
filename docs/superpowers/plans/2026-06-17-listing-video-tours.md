# Listing Video Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host one watermarked walkthrough video per listing on Cloudflare R2 and play it inline (tap-to-play) as the first slide of the existing detail-page gallery.

**Architecture:** A new offline pipeline (`scripts/video-upload.mjs` + shared `scripts/_watermark.mjs`) transcodes each WhatsApp clip with ffmpeg, overlays the existing "Rentoo" wordmark, extracts a watermarked poster, and uploads `tour.mp4` + `tour-{card,gallery,full}.webp` to R2 under base key `properties/<slug>/tour`. The media endpoint gains HTTP Range/206 support (required for iOS Safari `<video>`). `Gallery.astro` gains an optional video slide; both detail pages build a `tourVideo` from the `kind='video'` media row.

**Tech Stack:** Astro v6 SSR on Cloudflare Workers, R2 (`env.MEDIA` binding, bucket `rentoo-photos`), D1, sharp, ffmpeg 8.1.1, `@aws-sdk/client-s3`, vitest.

**Source spec:** `docs/superpowers/specs/2026-06-17-listing-video-tours-design.md` (read for rationale; this plan is self-contained for implementation).

## Global Constraints

- **Runtime:** Astro v6 SSR on Cloudflare Workers. Route files that hit bindings use `export const prerender = false;` and `import { env } from 'cloudflare:workers';`.
- **R2 binding:** `env.MEDIA` (cast `(env as unknown as Env).MEDIA` in routes), bucket name `rentoo-photos`, R2 account id `b572ad0da703afe2e58898eef8444b59`.
- **Storage convention:** one `property_media` row per video; base key `properties/<slug>/tour`; poster renditions at `tour-{card,gallery,full}.webp` (so `mediaUrl()` works unchanged); video at `tour.mp4` (new `videoUrl()` helper). No DB migration — `kind IN ('photo','video')` already exists.
- **`property_media` video row:** `kind='video'`, `r2_key='properties/<slug>/tour'` (NO extension), `display_order=-1`, `is_cover=1` only when the listing has no photos, `width`/`height` = displayed output dims, `watermarked=1`.
- **Watermark look (verbatim constants):** `WORDMARK_FRAC = 0.6`, `WHITE_OPACITY = 0.18`, `SHADOW_OPACITY = 0.22`; logo source `Rentoo.svg`.
- **ffmpeg:** binaries at `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`; long-edge cap `1280` (never upscale, even dims); `libx264 -crf 24 -preset medium -pix_fmt yuv420p -movflags +faststart`; keep audio `-c:a aac -b:a 96k -map 0:a?`; default autorotate (do NOT pass `-noautorotate`); encode concurrency `2`.
- **Clip selection:** one mp4 per folder, natural-sort-first, with `CLIP_OVERRIDE = { '#01': 'WhatsApp Video 2026-04-07 at 12.45.06 PM.mp4', '#37': 'WhatsApp Video 2026-04-08 at 8.07.20 PM.mp4' }`.
- **Commits:** commit after each task. Push the `milestone-1-dynamic` branch once the plan completes (or after integration, if executed in parallel worktrees) — the repo owner wants commits on `origin`.
- **Cache header for media:** `Cache-Control: public, max-age=31536000, immutable`.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `scripts/_watermark.mjs` | CREATE | Shared wordmark builder (constants, SVG loader, `setAlpha`, `makeWatermarkFactory`) used by both pipelines. |
| `scripts/watermark-upload.mjs` | MODIFY | Import from `./_watermark.mjs` (drop inline copies); scope photo `DELETE` to `kind='photo'`. |
| `scripts/video-upload.mjs` | CREATE | Transcode + watermark + poster pipeline; emits `seed/video-media.sql`. |
| `src/lib/media.ts` | MODIFY | Add `videoUrl(base)` helper. |
| `src/lib/range.ts` | CREATE | Pure `parseRange(header, size)` + `ParsedRange` type (unit-tested). |
| `src/lib/db.ts` | MODIFY | `attachPhotos()` scoped to `kind='photo'`. |
| `src/pages/media/[...key].ts` | REPLACE | Range/206 + 416 + HEAD endpoint using `parseRange`. |
| `src/components/Gallery.astro` | MODIFY | Optional `video?` prop, video slide 0, kind-gated `show()`, appended styles. |
| `src/pages/rent/[slug].astro` | MODIFY | Build `tourVideo`, update placeholder condition, pass `video` prop. |
| `src/pages/commercial/[slug].astro` | MODIFY | Same `tourVideo` wiring as rent. |
| `test/media.test.ts` | MODIFY | Add `videoUrl` tests. |
| `test/range.test.ts` | CREATE | `parseRange` unit tests. |
| `seed/video-media.sql` | GENERATE | Produced by `scripts/video-upload.mjs`; applied via wrangler. |

> **Note on test directory:** the existing vitest file is at `test/media.test.ts` (the spec text says `test/`). Confirm the directory name with `ls test*/` in Task 2 before writing; use whatever the repo already uses.

---

## Task 1: Shared watermark module + photo-script refactor

**Files:**
- Create: `scripts/_watermark.mjs`
- Modify: `scripts/watermark-upload.mjs` (imports + scoped DELETE)

**Interfaces:**
- Produces: `loadWordmarkSvgs(logoPath?) -> { svgWhite, svgBlack }`, `setAlpha(buf, opacity) -> Promise<Buffer>`, `makeWatermarkFactory(svgWhite, svgBlack) -> (imgWidth) => Promise<Buffer>`, and constants `WORDMARK_FRAC`, `WHITE_OPACITY`, `SHADOW_OPACITY`. Consumed by Task 8.

- [ ] **Step 1: Create `scripts/_watermark.mjs`**

```js
// scripts/_watermark.mjs — shared wordmark builder for the photo + video pipelines.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

export const WORDMARK_FRAC = 0.6;
export const WHITE_OPACITY = 0.18;
export const SHADOW_OPACITY = 0.22;

export function loadWordmarkSvgs(logoPath = 'Rentoo.svg') {
  const svgRaw = readFileSync(logoPath, 'utf8');
  return {
    svgWhite: svgRaw.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#ffffff"'),
    svgBlack: svgRaw.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#000000"'),
  };
}

// Multiply existing alpha by `opacity` via a uniform dest-in tile.
export async function setAlpha(buf, opacity) {
  return sharp(buf)
    .composite([{ input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png().toBuffer();
}

// Returns watermarkFor(imgWidth) -> padded transparent PNG: faint white wordmark + soft shadow.
export function makeWatermarkFactory(svgWhite, svgBlack) {
  const wmCache = new Map();
  return async function watermarkFor(imgWidth) {
    const wmW = Math.max(80, Math.round(imgWidth * WORDMARK_FRAC));
    if (wmCache.has(wmW)) return wmCache.get(wmW);
    const white = await sharp(Buffer.from(svgWhite)).resize({ width: wmW }).png().toBuffer();
    const { height: wmH } = await sharp(white).metadata();
    const black = await sharp(Buffer.from(svgBlack)).resize({ width: wmW }).blur(Math.max(1, wmW / 90)).png().toBuffer();
    const wf = await setAlpha(white, WHITE_OPACITY);
    const sf = await setAlpha(black, SHADOW_OPACITY);
    const pad = Math.round(wmW * 0.06);
    const off = Math.max(2, Math.round(wmW / 300));
    const wm = await sharp({ create: { width: wmW + pad * 2, height: wmH + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: sf, top: pad + off, left: pad + off }, { input: wf, top: pad, left: pad }])
      .png().toBuffer();
    wmCache.set(wmW, wm);
    return wm;
  };
}
```

- [ ] **Step 2: Refactor `scripts/watermark-upload.mjs` to import the shared module**

Replace the inline watermark block (the `svgRaw`/`svgWhite`/`svgBlack` constants, `setAlpha`, the `wmCache` + `watermarkFor` definitions — currently around lines 56–92) with an import + factory call. At the top of the file, alongside the existing imports, add:

```js
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';
```

Remove the now-duplicated `svgRaw`, `svgWhite`, `svgBlack`, `setAlpha`, `wmCache`, and `watermarkFor` definitions, and replace them with:

```js
const { svgWhite, svgBlack } = loadWordmarkSvgs(LOGO);
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);
```

Leave `renderSizes()` and everything else unchanged — it already calls `watermarkFor(meta.width)`.

- [ ] **Step 3: Scope the photo DELETE to `kind='photo'`**

In `scripts/watermark-upload.mjs`, find the emit line (around line 191):

```js
sql += `DELETE FROM property_media WHERE property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
```

Replace it with:

```js
sql += `DELETE FROM property_media WHERE kind='photo' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
```

- [ ] **Step 4: Verify the photo pipeline still runs identically (sample mode, no upload)**

Run: `node scripts/watermark-upload.mjs --sample`
Expected: exits 0, prints `folders: ... | listings with photos: ... | photos: ...` and writes previews to `seed/_preview/` exactly as before (no crash, no missing-import error).

- [ ] **Step 5: Commit**

```bash
git add scripts/_watermark.mjs scripts/watermark-upload.mjs
git commit -m "refactor(scripts): extract shared watermark module; scope photo DELETE to kind='photo'"
```

---

## Task 2: `videoUrl()` helper (TDD)

**Files:**
- Modify: `src/lib/media.ts`
- Test: `test/media.test.ts`

**Interfaces:**
- Produces: `videoUrl(r2KeyBase: string): string` → `/media/<base>.mp4`. Consumed by Tasks 7 (pages).

- [ ] **Step 1: Confirm the test directory and existing media test**

Run: `ls test*/ ; sed -n '1,20p' test/media.test.ts`
Expected: shows the existing media test importing from `../src/lib/media`. If the directory is `tests/` rather than `test/`, use that path in all following steps.

- [ ] **Step 2: Write the failing test**

Add to `test/media.test.ts` (extend the existing import line to include `videoUrl`):

```ts
import { mediaUrl, isAllowedReferer, videoUrl } from '../src/lib/media';

describe('videoUrl', () => {
  test('appends .mp4 to the base key', () => {
    expect(videoUrl('properties/3bhk-apartment-iskon-temple-03/tour'))
      .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour.mp4');
  });
  test('poster reuses mediaUrl on the same base key', () => {
    expect(mediaUrl('properties/3bhk-apartment-iskon-temple-03/tour', 'gallery'))
      .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour-gallery.webp');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/media.test.ts`
Expected: FAIL — `videoUrl is not a function` / `videoUrl is not exported`.

- [ ] **Step 4: Implement `videoUrl`**

In `src/lib/media.ts`, add below `mediaUrl`:

```ts
export function videoUrl(r2KeyBase: string): string {
  return `/media/${r2KeyBase}.mp4`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/media.test.ts`
Expected: PASS (both `videoUrl` tests green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/media.ts test/media.test.ts
git commit -m "feat(media): add videoUrl helper for tour mp4 URLs"
```

---

## Task 3: `parseRange()` pure function (TDD)

**Files:**
- Create: `src/lib/range.ts`
- Test: `test/range.test.ts`

**Interfaces:**
- Produces: `type ParsedRange = { type:'full' } | { type:'range'; offset:number; length:number } | { type:'unsatisfiable' }` and `parseRange(header: string | null, size: number): ParsedRange`. Consumed by Task 4 (endpoint).

- [ ] **Step 1: Write the failing test**

Create `test/range.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { parseRange } from '../src/lib/range';

describe('parseRange', () => {
  test('no header -> full', () => {
    expect(parseRange(null, 100)).toEqual({ type: 'full' });
  });
  test('bytes=0-1 -> first 2 bytes', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ type: 'range', offset: 0, length: 2 });
  });
  test('bytes=0- (iOS Safari probe) -> whole object', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ type: 'range', offset: 0, length: 100 });
  });
  test('bytes=50- -> tail from 50', () => {
    expect(parseRange('bytes=50-', 100)).toEqual({ type: 'range', offset: 50, length: 50 });
  });
  test('bytes=-20 (suffix) -> last 20 bytes', () => {
    expect(parseRange('bytes=-20', 100)).toEqual({ type: 'range', offset: 80, length: 20 });
  });
  test('bytes=20-10 (end < start) -> unsatisfiable', () => {
    expect(parseRange('bytes=20-10', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('start >= size -> unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('bytes=-0 -> unsatisfiable', () => {
    expect(parseRange('bytes=-0', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('size 0 with any range -> unsatisfiable', () => {
    expect(parseRange('bytes=0-0', 0)).toEqual({ type: 'unsatisfiable' });
  });
  test('end past EOF clamps to size-1', () => {
    expect(parseRange('bytes=90-999', 100)).toEqual({ type: 'range', offset: 90, length: 10 });
  });
  test('malformed header -> full', () => {
    expect(parseRange('bytes=abc', 100)).toEqual({ type: 'full' });
  });
  test('multi-range header -> full (R2 cannot emit multipart)', () => {
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ type: 'full' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/range.test.ts`
Expected: FAIL — cannot resolve `../src/lib/range`.

- [ ] **Step 3: Implement `src/lib/range.ts`**

```ts
// Pure single-range HTTP byte-range parser, validated against a known object size.
export type ParsedRange =
  | { type: 'full' }
  | { type: 'range'; offset: number; length: number }
  | { type: 'unsatisfiable' };

/**
 * Parse a single `Range: bytes=...` header against the total object size.
 * Supports `bytes=start-end`, `bytes=start-` (open-ended), and `bytes=-suffix`.
 * Multi-range / malformed -> 'full' (browsers send single ranges for media;
 * R2 cannot emit multipart/byteranges).
 */
export function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return { type: 'full' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: 'full' };

  const [, rawStart, rawEnd] = match;
  if (size === 0) return { type: 'unsatisfiable' };

  // Suffix form: `bytes=-N` -> last N bytes.
  if (rawStart === '') {
    if (rawEnd === '') return { type: 'unsatisfiable' };
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { type: 'unsatisfiable' };
    const length = Math.min(suffix, size);
    return { type: 'range', offset: size - length, length };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { type: 'unsatisfiable' };

  // `bytes=start-` (open-ended, e.g. iOS Safari's `bytes=0-` probe) runs to EOF.
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return { type: 'unsatisfiable' };

  return { type: 'range', offset: start, length: end - start + 1 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/range.test.ts`
Expected: PASS (all 12 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/range.ts test/range.test.ts
git commit -m "feat(media): add pure parseRange byte-range parser with unit tests"
```

---

## Task 4: Media endpoint Range/206 + HEAD

**Files:**
- Replace: `src/pages/media/[...key].ts`

**Interfaces:**
- Consumes: `parseRange`, `ParsedRange` from `src/lib/range.ts` (Task 3); `isAllowedReferer` from `src/lib/media.ts`.
- Produces: GET serving `200`/`206`/`416` by `Range` header; HEAD serving metadata. `.mp4` → `video/mp4`, else `image/webp`.

- [ ] **Step 1: Replace `src/pages/media/[...key].ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAllowedReferer } from '../../lib/media';
import { parseRange } from '../../lib/range';

export const prerender = false;

function contentTypeFor(key: string, fallback: string): string {
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.webp')) return 'image/webp';
  return fallback;
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key; // "properties/<slug>/0-card.webp" or "properties/<slug>/tour.mp4"
  if (!key) return new Response('Not found', { status: 404 });
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response('Forbidden', { status: 403 });

  const bucket = (env as unknown as Env).MEDIA;
  const rangeHeader = request.headers.get('range');

  // Cheap metadata fetch first so we validate the range before pulling a body.
  const head = await bucket.head(key);
  if (!head) return new Response('Not found', { status: 404 });

  const size = head.size;
  const parsed = parseRange(rangeHeader, size);

  const baseHeaders = new Headers();
  head.writeHttpMetadata(baseHeaders);
  baseHeaders.set('Content-Type', contentTypeFor(key, 'image/webp'));
  baseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
  baseHeaders.set('ETag', head.httpEtag);
  baseHeaders.set('Accept-Ranges', 'bytes');

  // Unsatisfiable range -> 416 with total size, no body.
  if (parsed.type === 'unsatisfiable') {
    const headers = new Headers(baseHeaders);
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Type');
    return new Response(null, { status: 416, headers });
  }

  // No Range -> 200 full body (still advertise Accept-Ranges).
  if (parsed.type === 'full') {
    const obj = await bucket.get(key);
    if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });
    const headers = new Headers(baseHeaders);
    headers.set('Content-Length', String(size));
    return new Response(obj.body, { status: 200, headers });
  }

  // Range present and satisfiable -> 206 Partial Content.
  const { offset, length } = parsed;
  const obj = await bucket.get(key, { range: { offset, length } });
  if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });

  // Trust the actual range R2 served (it may clamp length to EOF).
  const served = obj.range ?? { offset, length };
  const servedOffset = 'offset' in served && served.offset != null ? served.offset : offset;
  const servedLength = 'length' in served && served.length != null ? served.length : length;
  const end = servedOffset + servedLength - 1;

  const headers = new Headers(baseHeaders);
  headers.set('Content-Range', `bytes ${servedOffset}-${end}/${size}`);
  headers.set('Content-Length', String(servedLength));
  return new Response(obj.body, { status: 206, headers });
};

export const HEAD: APIRoute = async ({ params, request, locals }) => {
  const key = params.key;
  if (!key) return new Response(null, { status: 404 });
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response(null, { status: 403 });

  const head = await (env as unknown as Env).MEDIA.head(key);
  if (!head) return new Response(null, { status: 404 });

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('Content-Type', contentTypeFor(key, 'image/webp'));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', head.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(head.size));
  return new Response(null, { status: 200, headers });
};
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors (the `parseRange` import resolves; `R2Range`/`R2Object` types from `@cloudflare/workers-types` satisfy `bucket.get(key, { range: { offset, length } })`).

> If `astro check` flags the `served` narrowing on `obj.range`, it is because `R2Range` is a union; the `'offset' in served` / `'length' in served` guards above resolve it. Do not loosen to `any`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; `media/[...key].ts` compiles into the worker entry.

- [ ] **Step 4: Commit**

```bash
git add src/pages/media/[...key].ts
git commit -m "feat(media): add HTTP Range/206 + 416 + HEAD support to media endpoint"
```

> Live `206`/`416` curl smoke is in Task 9 (needs uploaded objects + `wrangler dev`).

---

## Task 5: `attachPhotos()` kind filter

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Consumes: nothing new. Produces: card carousels scoped to `kind='photo'`; video-only covers still resolve via the existing `cover_key` fallback.

- [ ] **Step 1: Scope the `attachPhotos` query to photos**

In `src/lib/db.ts`, in `attachPhotos()`, change the SELECT (currently lines ~13–18) to add `AND pm.kind = 'photo'`:

```ts
  const r = await db.prepare(
    `SELECT p.slug AS slug, pm.r2_key AS key
     FROM property_media pm JOIN properties p ON p.id = pm.property_id
     WHERE p.slug IN (${placeholders}) AND pm.kind = 'photo'
     ORDER BY pm.display_order ASC`
  ).bind(...slugs).all<{ slug: string; key: string }>();
```

Leave the fallback line unchanged — it is what renders a video-only listing's poster cover:

```ts
  for (const c of cards) c.photos = bySlug.get(c.slug) ?? (c.cover_key ? [c.cover_key] : []);
```

- [ ] **Step 2: Type-check + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "fix(db): scope attachPhotos to kind='photo' so video posters never leak into card carousels"
```

---

## Task 6: Gallery video slide

**Files:**
- Modify: `src/components/Gallery.astro`

**Interfaces:**
- Produces: `Props` now `{ images: { gallery; full; alt }[]; video?: { src: string; poster: string; alt: string } }`. When `video` is set it is slide 0; photos shift to `1..n`. Consumed by Task 7.

- [ ] **Step 1: Replace the frontmatter**

Replace the existing frontmatter (lines 1–5) with:

```astro
---
interface VideoProp { src: string; poster: string; alt: string }
interface Props {
  images: { gallery: string; full: string; alt: string }[];
  video?: VideoProp;
}
const { images, video } = Astro.props;
const hasVideo = !!video;
const coverImg = images[0];
const slideCount = (hasVideo ? 1 : 0) + images.length;
const single = slideCount <= 1;
---
```

- [ ] **Step 2: Replace the stage markup**

Replace the `<div class="gallery-stage"> ... </div>` block with:

```astro
  <div class="gallery-stage">
    {hasVideo && (
      <video
        class="gallery-video"
        data-gallery-video
        controls
        playsinline
        preload="none"
        poster={video!.poster}
        aria-label={video!.alt}
        width="1000"
        height="667"
      >
        <source src={video!.src} type="video/mp4" />
      </video>
    )}
    <img
      class="gallery-main"
      data-gallery-main
      src={hasVideo ? undefined : coverImg?.gallery}
      alt={coverImg?.alt}
      width="1000"
      height="667"
      hidden={hasVideo}
    />
    {!single && (
      <>
        <button type="button" class="gallery-nav gallery-nav--prev" data-gallery-prev aria-label="Previous slide">
          <span aria-hidden="true">&#8249;</span>
        </button>
        <button type="button" class="gallery-nav gallery-nav--next" data-gallery-next aria-label="Next slide">
          <span aria-hidden="true">&#8250;</span>
        </button>
        <div class="gallery-counter" data-gallery-counter aria-hidden="true">
          <span data-gallery-current>1</span> / {slideCount}
        </div>
      </>
    )}
  </div>
```

- [ ] **Step 3: Replace the thumbnail strip**

Replace the `<div class="gallery-thumbs"> ... </div>` block with:

```astro
  <div class="gallery-thumbs">
    {hasVideo && (
      <button
        class="gallery-thumb gallery-thumb--video"
        data-gallery-thumb
        data-kind="video"
        data-index="0"
        aria-label="Play video tour"
        aria-current="true"
      >
        <img src={video!.poster} alt={video!.alt} width="120" height="80" loading="lazy" />
        <span class="gallery-play-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </span>
      </button>
    )}
    {images.map((img, i) => {
      const slideIndex = hasVideo ? i + 1 : i;
      return (
        <button
          class="gallery-thumb"
          data-gallery-thumb
          data-kind="photo"
          data-index={slideIndex}
          data-full={img.gallery}
          aria-label={`Photo ${i + 1}`}
          aria-current={!hasVideo && i === 0 ? 'true' : 'false'}
        >
          <img src={img.gallery} alt={img.alt} width="120" height="80" loading="lazy" />
        </button>
      );
    })}
  </div>
```

- [ ] **Step 4: Replace the `<script>` block**

Replace the entire existing `<script> ... </script>` with:

```astro
<script>
  // Wired on every page load, including View Transitions navigations
  // (raw <script> tags don't re-execute on client-side nav).
  function initGalleries() {
    document.querySelectorAll('[data-gallery]').forEach((g) => {
      if ((g as HTMLElement).dataset.galleryReady) return;
      (g as HTMLElement).dataset.galleryReady = 'true';

      const main = g.querySelector('[data-gallery-main]') as HTMLImageElement | null;
      const video = g.querySelector('[data-gallery-video]') as HTMLVideoElement | null;
      const thumbs = Array.from(g.querySelectorAll('[data-gallery-thumb]')) as HTMLButtonElement[];
      const prevBtn = g.querySelector('[data-gallery-prev]');
      const nextBtn = g.querySelector('[data-gallery-next]');
      const current = g.querySelector('[data-gallery-current]');
      const total = thumbs.length;
      if (!main || total === 0) return;

      let index = 0;

      const show = (next: number) => {
        index = (next + total) % total; // wrap-around
        const thumb = thumbs[index];
        const kind = thumb.getAttribute('data-kind');

        if (kind === 'video') {
          // Reveal the video; hide the photo <img>. Do NOT touch main.src here.
          if (video) { video.hidden = false; main.hidden = true; }
        } else {
          // Photo slide: pause + hide the video if we are leaving it.
          if (video && !video.paused) video.pause();
          if (video) video.hidden = true;
          main.hidden = false;

          const full = thumb.getAttribute('data-full');
          if (full && main.getAttribute('src') !== full) {
            // Preload, then crossfade to the new photo.
            const img = new Image();
            img.onload = () => { main.src = full; main.style.opacity = '1'; };
            main.style.opacity = '0';
            img.src = full;
          }
        }

        thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
        if (current) current.textContent = String(index + 1);
      };

      thumbs.forEach((t, i) => t.addEventListener('click', () => show(i)));
      prevBtn?.addEventListener('click', () => show(index - 1));
      nextBtn?.addEventListener('click', () => show(index + 1));

      g.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
        else if (key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
      });
    });
  }

  document.addEventListener('astro:page-load', initGalleries);
</script>
```

- [ ] **Step 5: Append the new styles**

Keep the entire existing `<style>` block unchanged and append, just before its closing `</style>`:

```css
  /* ── Video slide ── */
  .gallery-video {
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 2;
    object-fit: contain;            /* vertical WhatsApp clip letterboxed, not cropped */
    background: #000;
    border-radius: var(--r-md, 8px);
    display: block;
    box-shadow: var(--elev-2, 0 4px 8px rgba(8, 39, 70, 0.08));
  }
  .gallery-video[hidden] { display: none; }
  .gallery-main[hidden] { display: none; }

  .gallery-thumb--video { position: relative; }

  .gallery-play-badge {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--paper, #fff);
    background: color-mix(in srgb, var(--jaipur-navy, #082746) 28%, transparent);
    pointer-events: none;           /* clicks fall through to the button */
  }
  .gallery-play-badge svg { filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5)); }
```

- [ ] **Step 6: Type-check + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds. (No `kind='video'` rows exist yet, so live pages still render photo-only — this task only proves the component compiles and is backward-compatible.)

- [ ] **Step 7: Commit**

```bash
git add src/components/Gallery.astro
git commit -m "feat(gallery): optional video slide (slide 0, tap-to-play, inline) with poster thumb"
```

---

## Task 7: Detail-page wiring (rent + commercial)

**Files:**
- Modify: `src/pages/rent/[slug].astro`
- Modify: `src/pages/commercial/[slug].astro`

**Interfaces:**
- Consumes: `videoUrl` (Task 2), `mediaUrl` (existing), `Gallery` `video?` prop (Task 6), `media` rows from `getListingBySlug`.

- [ ] **Step 1: Add `videoUrl` to the media import (both files)**

In each file change:

```ts
import { mediaUrl } from '../../lib/media';
```

to:

```ts
import { mediaUrl, videoUrl } from '../../lib/media';
```

- [ ] **Step 2: Build `tourVideo` after the `images` line (both files)**

Immediately after the existing `const images = media.filter(m => m.kind === 'photo').map(...)` block, add:

```ts
const tourVideo = (() => {
  const v = media.find(m => m.kind === 'video');
  if (!v) return undefined;
  return {
    src: videoUrl(v.r2_key),                 // /media/properties/<slug>/tour.mp4
    poster: mediaUrl(v.r2_key, 'gallery'),   // /media/properties/<slug>/tour-gallery.webp
    alt: `${property.display_id} video tour`,
  };
})();
```

- [ ] **Step 3: Update the gallery/placeholder block (both files)**

Replace the existing gallery section:

```astro
  {images.length > 0 ? (
    <div class="gallery-section">
      <div class="section-inner">
        <Gallery images={images} />
      </div>
    </div>
  ) : (
    <div class="gallery-placeholder" aria-hidden="true">
      <div class="section-inner"><div class="no-photos">Photos coming soon</div></div>
    </div>
  )}
```

with:

```astro
  {(images.length > 0 || tourVideo) ? (
    <div class="gallery-section">
      <div class="section-inner">
        <Gallery images={images} video={tourVideo} />
      </div>
    </div>
  ) : (
    <div class="gallery-placeholder" aria-hidden="true">
      <div class="section-inner"><div class="no-photos">Photos coming soon</div></div>
    </div>
  )}
```

- [ ] **Step 4: Type-check + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/rent/[slug].astro src/pages/commercial/[slug].astro
git commit -m "feat(detail): render tour video as gallery slide 0 on rent + commercial pages"
```

---

## Task 8: `scripts/video-upload.mjs` pipeline

**Files:**
- Create: `scripts/video-upload.mjs`

**Interfaces:**
- Consumes: `loadWordmarkSvgs`, `makeWatermarkFactory`, `setAlpha` from `./_watermark.mjs` (Task 1); `seed/photos.json` (`display_id → slug`); ffmpeg/ffprobe.
- Produces: R2 objects `properties/<slug>/tour.mp4` + `tour-{card,gallery,full}.webp`; `seed/video-media.sql`.

- [ ] **Step 1: Create `scripts/video-upload.mjs`**

```js
// Transcode every listing walkthrough, watermark it, upload tour.mp4 + poster WebPs to R2,
// then emit seed/video-media.sql.
//
//   node scripts/video-upload.mjs --sample          # local previews for a few listings, no upload
//   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node scripts/video-upload.mjs                  # full run: transcode + upload + seed/video-media.sql
//
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';

// ---- config ----
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'b572ad0da703afe2e58898eef8444b59';
const BUCKET = 'rentoo-photos';
const INVENTORY = 'inventory 2026';
const LOGO = 'Rentoo.svg';
const SAMPLE = process.argv.includes('--sample');
const SAMPLE_LIMIT = 3;

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const CAP = 1280;
const CONCURRENCY = 2;
const VIDEO_RE = /\.mp4$/i;
const IMG_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

const SIZES = [
  { name: 'card', width: 600, quality: 72 },
  { name: 'gallery', width: 1200, quality: 80 },
  { name: 'full', width: 2000, quality: 82 },
];

// Resolved by metadata probe (longest clip <= ~120s) + eyeball. Only #01/#37 need overriding.
const CLIP_OVERRIDE = {
  '#01': 'WhatsApp Video 2026-04-07 at 12.45.06 PM.mp4',
  '#37': 'WhatsApp Video 2026-04-08 at 8.07.20 PM.mp4',
};

// ---- s3 / r2 ----
const AK = process.env.R2_ACCESS_KEY_ID;
const SK = process.env.R2_SECRET_ACCESS_KEY;
let s3 = null;
if (!SAMPLE) {
  if (!AK || !SK) {
    console.error('Missing R2 credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or run with --sample).');
    process.exit(1);
  }
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: AK, secretAccessKey: SK },
  });
}

// ---- watermark ----
const { svgWhite, svgBlack } = loadWordmarkSvgs(LOGO);
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);

// ---- ffmpeg helpers ----
function run(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 400)}`))));
  });
}
function runBuf(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args);
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 400)}`))));
  });
}
const probe1 = (src, ent) =>
  run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', ent, '-of', 'csv=p=0', src])
    // ffprobe csv=p=0 can emit a trailing comma on some containers ("640,"); take the leading
    // signed integer token so width/height/rotation never parse to NaN. Empty -> '' -> 0 downstream.
    .then((s) => { const m = s.match(/-?\d+/); return m ? m[0] : ''; });

async function outputDims(src) {
  const cw = +(await probe1(src, 'stream=width'));
  const ch = +(await probe1(src, 'stream=height'));
  const rot = Math.abs(+(await probe1(src, 'stream_side_data=rotation')) || 0) % 180;
  let dw = cw, dh = ch;
  if (rot === 90) { dw = ch; dh = cw; }                 // displayed dims
  const long = Math.max(dw, dh), s = long > CAP ? CAP / long : 1;
  return { ow: Math.round((dw * s) / 2) * 2, oh: Math.round((dh * s) / 2) * 2 };
}

async function transcode(src, wmPng, ow, oh, outMp4) {
  await run(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', src, '-i', wmPng,
    '-filter_complex',
      `[0:v]scale=${ow}:${oh}:flags=lanczos,format=yuv420p[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k',
    '-map_metadata', '-1', '-map_chapters', '-1',
    outMp4,
  ]);
}

// Poster: representative frame ~1s in (skips black first frame), upright via default autorotate.
function posterPng(src) {
  return runBuf(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-ss', '00:00:01', '-i', src, '-frames:v', '1', '-q:v', '2', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
}

// Poster PNG -> 3 watermarked WebP renditions (same look as photos).
async function renderPosterSizes(posterBuf) {
  const base = sharp(posterBuf).rotate();
  const out = {};
  for (const s of SIZES) {
    const resized = await base.clone().resize({ width: s.width, withoutEnlargement: true }).toBuffer();
    const meta = await sharp(resized).metadata();
    let wm = await watermarkFor(meta.width);
    const wmMeta = await sharp(wm).metadata();
    if (wmMeta.width > meta.width || wmMeta.height > meta.height) {
      wm = await sharp(wm).resize({ width: Math.round(meta.width * 0.92), height: Math.round(meta.height * 0.92), fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    }
    out[s.name] = await sharp(resized).composite([{ input: wm, gravity: 'center' }]).webp({ quality: s.quality }).toBuffer();
  }
  return out;
}

async function upload(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

// ---- simple promise pool ----
async function pool(items, n, worker) {
  let i = 0, done = 0; const total = items.length;
  async function runOne() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); }
      catch (e) { console.error('  ! failed:', items[idx]?.folder, e.message); }
      done++;
      process.stdout.write(`\r  processed ${done}/${total} videos…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runOne));
  process.stdout.write('\n');
}

// ---- build work list ----
const photos = JSON.parse(readFileSync('seed/photos.json', 'utf8'));
const slugByDisplay = new Map(photos.map((p) => [p.display_id, p.slug]));

const folders = readdirSync(INVENTORY, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('#'))
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const work = [];
const skipped = [];
for (const folder of folders) {
  const slug = slugByDisplay.get(folder);
  if (!slug) { skipped.push(`${folder} (no live listing)`); continue; }
  const dir = join(INVENTORY, folder);
  const mp4s = readdirSync(dir).filter((f) => VIDEO_RE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!mp4s.length) { continue; }                       // photo-only listing -> media.sql owns it
  const pick = CLIP_OVERRIDE[folder] && mp4s.includes(CLIP_OVERRIDE[folder]) ? CLIP_OVERRIDE[folder] : mp4s[0];
  const hasPhotos = readdirSync(dir).some((f) => IMG_RE.test(f));
  work.push({ folder, slug, src: join(dir, pick), isCover: !hasPhotos });
}

console.log(`folders: ${folders.length} | videos to process: ${work.length}`);
if (skipped.length) console.log(`skipped ${skipped.length}:`, skipped.slice(0, 8).join('; '), skipped.length > 8 ? '…' : '');

mkdirSync('seed/_preview', { recursive: true });
const tmpDir = 'seed/_preview';

// ---- process one listing ----
const rows = new Map();
async function processOne(w) {
  const { ow, oh } = await outputDims(w.src);
  const wm = await watermarkFor(ow);
  const wmPng = join(tmpDir, `wm-${w.slug}.png`);
  writeFileSync(wmPng, wm);

  const outMp4 = join(tmpDir, `${w.slug}-tour.mp4`);
  await transcode(w.src, wmPng, ow, oh, outMp4);
  const poster = await renderPosterSizes(await posterPng(w.src));

  if (SAMPLE) {
    writeFileSync(join(tmpDir, `${w.slug}-tour-gallery.webp`), poster.gallery);
    console.log(`  preview -> ${outMp4} (+ poster) [${ow}x${oh}]`);
    return;
  }

  const mp4Buf = readFileSync(outMp4);
  await upload(`properties/${w.slug}/tour.mp4`, mp4Buf, 'video/mp4');
  for (const s of SIZES) await upload(`properties/${w.slug}/tour-${s.name}.webp`, poster[s.name], 'image/webp');
  rows.set(w.slug, { uuid: randomUUID(), w: ow, h: oh, isCover: w.isCover });
}

// ---- run ----
const list = SAMPLE ? work.slice(0, SAMPLE_LIMIT) : work;
await pool(list, CONCURRENCY, processOne);

if (SAMPLE) {
  console.log(`\nWrote ${list.length} previews to ${tmpDir}/. Open the *-tour.mp4 to check orientation + watermark, then re-run without --sample.`);
  process.exit(0);
}

// ---- emit seed/video-media.sql ----
let sql = '-- generated by scripts/video-upload.mjs — property_media rows for uploaded tour videos\n';
let n = 0;
for (const [slug, r] of rows) {
  sql += `DELETE FROM property_media WHERE kind='video' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
  sql += `INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked) `
    + `SELECT '${r.uuid}', id, 'video', 'properties/${slug}/tour', -1, ${r.isCover ? 1 : 0}, ${r.w}, ${r.h}, 1 `
    + `FROM properties WHERE slug='${slug}';\n`;
  n++;
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/video-media.sql', sql);
console.log(`\nDone. Uploaded ${rows.size} tours. Wrote ${n} video rows to seed/video-media.sql.`);
console.log('Next: npx wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql');
```

- [ ] **Step 2: Run sample mode and eyeball**

Run: `node scripts/video-upload.mjs --sample`
Expected: exits 0; prints `videos to process: 49` (±, depending on the live inventory) and writes `seed/_preview/<slug>-tour.mp4` + `<slug>-tour-gallery.webp` for 3 listings. Open the previews and confirm: **upright portrait** orientation (not sideways), centered faint "Rentoo" wordmark matching the photo look, no black/blank poster, plausible size (a 60s clip ≈ 5–15 MB).

- [ ] **Step 3: Commit the script (not the previews)**

```bash
git add scripts/video-upload.mjs
git commit -m "feat(scripts): video-upload pipeline (ffmpeg transcode + watermark + poster -> R2)"
```

> `seed/_preview/` is already gitignored by the photo pipeline's convention; confirm it is not staged.

---

## Task 9: Generate, apply, deploy, end-to-end verify

**Files:**
- Generate: `seed/video-media.sql`
- No source changes — operational task (needs R2 credentials + `wrangler` auth).

**Interfaces:**
- Consumes: all prior tasks. Produces: live tour videos on production.

- [ ] **Step 1: Full pipeline run (uploads + SQL)**

Run:
```bash
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node scripts/video-upload.mjs
```
Expected: `processed N/N videos…`, then `Uploaded N tours. Wrote N video rows to seed/video-media.sql`.

- [ ] **Step 2: Apply the seed to D1 (remote)**

Run: `npx wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql`
Expected: N INSERTs succeed.

- [ ] **Step 3: Idempotency / footgun check**

Run: `npx wrangler d1 execute rentoo-listings --remote --file=seed/media.sql && npx wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql`
Then: `npx wrangler d1 execute rentoo-listings --remote --command "SELECT kind, COUNT(*) FROM property_media GROUP BY kind"`
Expected: BOTH `photo` and `video` rows present (scoped DELETEs did not wipe each other).

- [ ] **Step 4: Range + inline-playback smoke (local)**

Run: `npx wrangler dev` (or `npm run preview`), then in another shell:
```bash
curl -s -D - -o /dev/null -H 'Referer: http://localhost:8787' -H 'Range: bytes=0-1' \
  http://localhost:8787/media/properties/<video-only-slug>/tour.mp4
```
Expected: `HTTP/1.1 206 Partial Content`, `Content-Range: bytes 0-1/<size>`, `Accept-Ranges: bytes`, `Content-Type: video/mp4`.

```bash
curl -s -D - -o /dev/null -H 'Referer: http://localhost:8787' -H 'Range: bytes=999999999-' \
  http://localhost:8787/media/properties/<video-only-slug>/tour.mp4
```
Expected: `HTTP/1.1 416 Range Not Satisfiable`, `Content-Range: bytes */<size>`.

Load the video-only listing page in a browser (responsive/iOS emulation): gallery shows the poster with a ▶ badge; tapping plays **inline** (no fullscreen takeover); navigating to a photo pauses the video. A photo+video listing shows the video as slide 0, then photos. Card grids show the poster cover for video-only listings, with no broken card-carousel slide.

- [ ] **Step 5: Full test suite + build**

Run: `npx vitest run && npx astro check && npm run build`
Expected: all green.

- [ ] **Step 6: Commit the seed and deploy**

```bash
git add seed/video-media.sql
git commit -m "chore(seed): video-media.sql for listing tour videos"
git push origin milestone-1-dynamic
npm run deploy   # or: npx wrangler deploy — match the repo's existing deploy script
```
Expected: deploy succeeds; spot-check a video-only listing on the live worker URL plays inline.

---

## Self-Review

**Spec coverage:** §2 storage convention → Tasks 8 (upload keys) + 7 (URL build). §3.1 `videoUrl` → Task 2. §3.2 row shape → Task 8 SQL emit. §3.3 `attachPhotos` → Task 5. §3.4 scoped DELETEs → Task 1 (photo) + Task 8 (video). §4 pipeline → Tasks 1 + 8. §5 Range endpoint → Tasks 3 + 4. §6 Gallery + pages → Tasks 6 + 7. §7 cost → informational. §8 testing → Tasks 2, 3, 9. §10 checklist → all tasks. Covered.

**Placeholder scan:** No TBD/TODO; all code blocks complete; the only intentionally-blank values are the R2 credentials in Task 9 Step 1 (secrets, supplied at run time) and `<video-only-slug>`/`<size>` in curl examples (runtime values).

**Type consistency:** `parseRange(header, size) -> ParsedRange` (Task 3) ↔ imported + used in Task 4. `videoUrl(base) -> string` (Task 2) ↔ used in Task 7. Gallery `Props { images, video? }` with `video: { src, poster, alt }` (Task 6) ↔ `tourVideo` shape built in Task 7 matches exactly. `makeWatermarkFactory`/`loadWordmarkSvgs`/`setAlpha` (Task 1) ↔ imported in Task 8. R2 row columns in Task 8 SQL match `migrations/0001_init.sql`.

---

## Post-Review Hardening (2026-06-17)

A multi-agent adversarial review of the implementation diff returned **17 findings (10 minor, 7 nits, 0 blockers/majors)** plus 2 rejected false positives. Applied before push:

- **Endpoint** `media/[...key].ts`: no-Range hot path now serves from a single `bucket.get()` (was `head()`+`get()` — halved R2 reads on every image); `Cache-Control: immutable` only on full 200, dropped on 206, `no-store` on 416; corrected the inaccurate "clamp" comment.
- **Gallery** `keydown`: guard `if (e.target.closest('[data-gallery-video]')) return;` so arrow keys seek the focused video instead of navigating away.
- **Pipeline** `video-upload.mjs`: poster falls back to a first-frame grab when the `-ss 1` seek yields 0 bytes (and hard-fails if still empty); failed listings are enumerated and the run exits non-zero; posters upload before the heavy `tour.mp4` (fewer orphans on partial failure) with best-effort temp cleanup; slugs asserted `^[a-z0-9-]+$` before SQL/key interpolation.

**Deferred follow-ups (latent only; hold by construction today):**
- Partial unique index `CREATE UNIQUE INDEX idx_media_one_cover ON property_media(property_id) WHERE is_cover = 1;` to make the "one cover per property" invariant a DB guarantee rather than a cross-script JS convention (prevents inflated card grids / off-by-one pagination if a double-cover ever slips in).
- HTTP/data-layer tests (attachPhotos kind-scoping, endpoint 206/416/HEAD header arithmetic) — needs a SQLite/Miniflare test harness the repo doesn't have yet.
- Regenerate the stale gitignored `seed/media.sql` artifact (its DELETEs predate the `kind='photo'` scoping) before any photo reseed; never hand-apply the old copy.
