# Listing Video Tours on R2 — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review
**Branch target:** `milestone-1-dynamic`
**Scope:** Host one watermarked "video tour" walkthrough per listing on Cloudflare R2 (zero egress) and play it inline, tap-to-play, as the first slide of the existing detail-page gallery.

---

## 1. Overview & Goals

Rentoo has 56 source walkthrough `.mp4` files in `inventory 2026/#NN/`, spanning **49 listing folders** (6 folders carry 2–3 clips — `#01, #03, #44, #86, #88` have 2, `#37` has 3). Today these never ship: a listing with no photos shows a "Photos coming soon" placeholder, and the ~29 video-only listings are dark.

**What ships:**

- A new pipeline (`scripts/video-upload.mjs` + shared `scripts/_watermark.mjs`) that transcodes, watermarks, and uploads **one tour video per listing** to R2 under base key `properties/<slug>/tour`, alongside a watermarked poster derivative (`tour-{card,gallery,full}.webp`).
- HTTP **Range / 206** support added to `src/pages/media/[...key].ts` — **a hard prerequisite**: iOS Safari sends a `Range` probe before rendering `<video>` and refuses to play if the server answers `200` with the whole body. Without this the encode work is wasted on the primary mobile target.
- A `videoUrl()` helper, a kind-scoped `attachPhotos()`, scoped `DELETE`s in both seed scripts, and a video-first `Gallery.astro` slide.
- Detail-page wiring (`rent/[slug].astro` + `commercial/[slug].astro`) that builds a `tourVideo` from the `kind='video'` media row and updates the placeholder condition.

**Outcome:** all 49 listings with a walkthrough light up. The ~29 video-only listings get a real, watermarked, tappable tour and a working card cover (via the poster derivative + `cover_key` fallback). Listings with both photos and a video show the video as gallery slide 0, photos after.

**Non-goals:** Cloudflare Stream, fly.io, autoplay, multi-video-per-listing UI, audio normalization, HLS/adaptive bitrate.

> **Corpus note:** the original brief said "56 videos." There are 56 source files but only **49 listings**. The design processes one tour per listing (49 `tour.mp4` objects + 49 `property_media` video rows). The extra clips in the 6 multi-video folders are resolved by a natural-sort-first pick plus a `CLIP_OVERRIDE` map. See §9 open questions.

---

## 2. Storage & Naming Convention

One `property_media` row per video. **Base key:** `properties/<slug>/tour`. Objects stored under that base:

| Object key | Content-Type | Purpose |
| --- | --- | --- |
| `properties/<slug>/tour.mp4` | `video/mp4` | Compressed + watermarked + faststart H.264 walkthrough |
| `properties/<slug>/tour-card.webp` | `image/webp` | Watermarked poster, 600px — card cover for video-only listings |
| `properties/<slug>/tour-gallery.webp` | `image/webp` | Watermarked poster, 1200px — `<video poster>` + gallery thumb |
| `properties/<slug>/tour-full.webp` | `image/webp` | Watermarked poster, 2000px — lightbox parity |

**Why this shape:**

- The poster WebPs follow the exact `-{size}.webp` suffix that `mediaUrl(base, size)` already produces, so **`mediaUrl('properties/<slug>/tour', 'card')` works unchanged** → `/media/properties/<slug>/tour-card.webp`.
- The `.mp4` lives at `<base>.mp4` (no size suffix), reached by a new `videoUrl(base)` helper.
- A video-only listing's card cover "just works": the video row carries `is_cover=1`, so `SELECT_CARD`'s `LEFT JOIN ... ON is_cover=1` yields `cover_key='properties/<slug>/tour'`, and `PropertyCard` renders `mediaUrl(cover_key,'card')` = the poster.

Bucket is `rentoo-photos` (binding `env.MEDIA`), shared with photos.

---

## 3. Data Model & Wiring

No DB migration needed: `migrations/0001_init.sql` already defines `kind TEXT CHECK(kind IN ('photo','video'))`. The video row reuses the existing 9-column shape.

### 3.1 `videoUrl()` helper — `src/lib/media.ts` (ADD)

```ts
// src/lib/media.ts — ADD below mediaUrl(); poster reuses mediaUrl() unchanged.
export function videoUrl(r2KeyBase: string): string {
  return `/media/${r2KeyBase}.mp4`;
}
// videoUrl('properties/3bhk-apartment-iskon-temple-03/tour')
//   -> '/media/properties/3bhk-apartment-iskon-temple-03/tour.mp4'
// mediaUrl('properties/3bhk-apartment-iskon-temple-03/tour', 'gallery')
//   -> '/media/properties/3bhk-apartment-iskon-temple-03/tour-gallery.webp'
```

### 3.2 `property_media` video row shape

```
kind          = 'video'
r2_key        = 'properties/<slug>/tour'        -- base key, NO extension
display_order = -1                              -- sorts before photos (0..n-1); inert once attachPhotos is kind-scoped
is_cover      = 1  only if the listing has NO photo rows (video-only); else 0
width,height  = DISPLAY dims from ffprobe of the TRANSCODED tour.mp4 (see §4.5 rotation)
watermarked   = 1
```

**`is_cover` rule:** `is_cover=1` exclusively for video-only listings, so for photo+video listings the real photo keeps the cover (`SELECT_CARD` joins on `is_cover=1`). The video-upload script determines this by checking whether the inventory folder contains any image files.

**`display_order` rule:** not load-bearing for the detail gallery — the detail page orders video-first in code (`media.find(kind==='video')` then `media.filter(kind==='photo')`). It only matters as `attachPhotos`'s `ORDER BY`, which becomes `kind='photo'`-scoped, so `-1` never displaces `photo[0]`.

### 3.3 `attachPhotos()` kind filter — `src/lib/db.ts` (EDIT)

The current query pulls **all** `property_media` kinds, so a video base key would leak into card carousels as a broken `<base>-card.webp` slide. Scope it to photos:

```ts
// src/lib/db.ts — attachPhotos(): add "AND pm.kind = 'photo'"
const r = await db.prepare(
  `SELECT p.slug AS slug, pm.r2_key AS key
   FROM property_media pm JOIN properties p ON p.id = pm.property_id
   WHERE p.slug IN (${placeholders}) AND pm.kind = 'photo'
   ORDER BY pm.display_order ASC`
).bind(...slugs).all<{ slug: string; key: string }>();
```

The existing fallback line is **unchanged** and is what makes video-only covers render:

```ts
for (const c of cards) c.photos = bySlug.get(c.slug) ?? (c.cover_key ? [c.cover_key] : []);
```

For a video-only slug, `bySlug` has no entry → `c.photos = [cover_key]` = `['properties/<slug>/tour']` → `PropertyCard` renders `mediaUrl(cover_key,'card')` = `/media/properties/<slug>/tour-card.webp`. Confirmed end-to-end against `sql.ts:8`, `PropertyCard.astro:9`, `db.ts:25`.

### 3.4 Scoped-DELETE footgun fix (BOTH scripts)

`seed/media.sql` currently emits an **unscoped** `DELETE FROM property_media WHERE property_id=...`. Re-running the photo pipeline would wipe video rows; re-running the video pipeline would wipe photo rows. Scope **both** by kind so the two seed files are order-independent at apply time.

```js
// scripts/watermark-upload.mjs — scope the photo DELETE (line ~191)
sql += `DELETE FROM property_media WHERE kind='photo' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
```

```js
// scripts/video-upload.mjs — scope the video DELETE
sql += `DELETE FROM property_media WHERE kind='video' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
```

---

## 4. Pipeline — `scripts/video-upload.mjs` + `scripts/_watermark.mjs`

ffmpeg 8.1.1 and ffprobe are installed at `/opt/homebrew/bin`. The recipe was validated end-to-end on real inventory.

### 4.1 Shared watermark module — `scripts/_watermark.mjs` (NEW)

Factor the wordmark builder out of `watermark-upload.mjs` so both scripts produce a **byte-identical** watermark look. Export the constants, the SVG loader, `setAlpha`, and a factory wrapping the `wmCache` + `watermarkFor`:

```js
// scripts/_watermark.mjs (NEW)
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

export async function setAlpha(buf, opacity) {
  return sharp(buf)
    .composite([{ input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png().toBuffer();
}

// Returns watermarkFor(imgWidth) -> padded transparent PNG with faint white wordmark + soft shadow.
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

`watermark-upload.mjs` is refactored to import `makeWatermarkFactory`, `loadWordmarkSvgs`, `setAlpha` from `./_watermark.mjs` (its inline copies of these are removed; behavior unchanged). `video-upload.mjs` imports the same.

### 4.2 Rotation-safe output dimensions

`ffprobe stream=width,height` returns **coded** dims; 12 of 56 phone clips carry a `-90` display-matrix and landscape coded dims. Naively using coded dims sizes the watermark and output sideways. Read the rotation side-data, swap to **displayed** dims, cap the long edge at **1280** (no upscale), and round each axis to even (yuv420p requires even W/H):

```js
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const CAP = 1280;

const probe1 = (src, ent) =>
  run(FFPROBE, ['-v','error','-select_streams','v:0','-show_entries',ent,'-of','csv=p=0',src])
    .then(s => s.split('\n')[0].trim());

async function outputDims(src) {
  const cw = +await probe1(src, 'stream=width');
  const ch = +await probe1(src, 'stream=height');
  const rot = Math.abs(+(await probe1(src, 'stream_side_data=rotation')) || 0) % 180;
  let dw = cw, dh = ch; if (rot === 90) { dw = ch; dh = cw; }      // displayed dims
  const long = Math.max(dw, dh), s = long > CAP ? CAP / long : 1;  // never upscale
  return { ow: Math.round(dw * s / 2) * 2, oh: Math.round(dh * s / 2) * 2 };
}
```

### 4.3 Transcode + watermark — exact ffmpeg command

Use ffmpeg's **default autorotate** (do **NOT** pass `-noautorotate`): the display-matrix rotation is inserted *before* the user filtergraph, so `scale`+`overlay` operate on the correct portrait frame and the output bakes orientation in with no residual side-data (verified). The watermark is a per-video PNG (rendered by the shared factory at `0.6 × outputWidth`) overlaid centered — PNG-overlay reproduces the exact SVG glyphs + soft shadow that photos use; `drawtext` cannot.

```bash
ffmpeg -y -hide_banner -loglevel error \
  -i "$SRC" -i /tmp/wm.png \
  -filter_complex "[0:v]scale=${OW}:${OH}:flags=lanczos,format=yuv420p[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2[v]" \
  -map "[v]" -map "0:a?" \
  -c:v libx264 -crf 24 -preset medium -pix_fmt yuv420p \
  -movflags +faststart \
  -c:a aac -b:a 96k \
  -map_metadata -1 -map_chapters -1 \
  tour.mp4
```

Node `spawn` args array:

```js
await run(FFMPEG, [
  '-y','-hide_banner','-loglevel','error',
  '-i', src, '-i', wmPng,
  '-filter_complex',
    `[0:v]scale=${ow}:${oh}:flags=lanczos,format=yuv420p[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2[v]`,
  '-map','[v]','-map','0:a?',                 // '0:a?' keeps silent clips from aborting
  '-c:v','libx264','-crf','24','-preset','medium','-pix_fmt','yuv420p',
  '-movflags','+faststart',                   // moov before mdat -> instant web start
  '-c:a','aac','-b:a','96k',
  '-map_metadata','-1','-map_chapters','-1',
  outMp4,
]);
```

**Encoder rationale (measured on real inventory):** CRF 24 / preset medium is the sweet spot for 480–720px-wide phone H.264. Worst high-motion clip `#86` measured 23→52MB, 24→47MB, 26→37MB; CRF 23 wastes bytes on flat-wall walkthrough footage, 26 softens textured surfaces. All clips are SD-range `yuv420p/bt709` (no HDR → no tonemapping).

### 4.4 Poster extraction

Grab a representative frame ~1s in (skips the black/blurry first frame), upright via default autorotate. Put `-ss` **before** `-i` for fast accurate seek. Pipe the raw PNG into the existing `sharp` `renderSizes()` path so `tour-card/gallery/full.webp` come out of the **same** watermark+resize code (verified: watermarked ~480×848 WebP, 10–14 KB each):

```bash
ffmpeg -y -hide_banner -loglevel error -ss 00:00:01 -i "$SRC" -frames:v 1 -q:v 2 -f image2 poster.png
```

```js
// poster() returns a PNG buffer, then hand to renderSizes() (sharp .rotate() is a harmless
// no-op on the already-oriented PNG) -> tour-card/gallery/full.webp.
async function poster(src) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ['-y','-hide_banner','-loglevel','error',
      '-ss','00:00:01','-i', src, '-frames:v','1','-q:v','2','-c:v','png','-f','image2pipe','pipe:1']);
    const chunks = []; let err = '';
    p.stdout.on('data', d => chunks.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('close', c => c === 0 ? res(Buffer.concat(chunks)) : rej(new Error('poster ' + err)));
  });
}
```

### 4.5 Row dimensions

Write the `property_media` `width`/`height` from **`ffprobe` of the transcoded `tour.mp4`** (which already has rotation baked in, so its reported dims are display dims) — or equivalently use the `outputDims()` result `{ow, oh}`. Do **not** write coded dims of the source.

### 4.6 Folder → clip selection, `--sample`, concurrency

- Same `seed/photos.json` `display_id → slug` map as the photo pipeline.
- One mp4 per folder by **natural-sort-first**, with a `CLIP_OVERRIDE` map for the 6 ambiguous multi-clip folders. Verified by running the actual sort: `#01` picks `af.mp4` (likely wrong → override to the WhatsApp clip); `#03` picks `3.mp4` over `4.mp4` (correct). Each multi-video folder (`#01,#03,#37,#44,#86,#88`) must be eyeballed and overridden where the first natural-sort pick is not the intended tour.
- `--sample`: write a few local `tour.mp4` + poster previews, no upload (mirrors the photo pipeline's `--sample`).
- **Concurrency = 2.** A single preset-medium encode at ≤1280px already uses ~5–6 cores (measured ~549% CPU); 2 saturates an 8-core Mac, more just thrashes. Files up to 73MB.

```js
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadWordmarkSvgs, makeWatermarkFactory, setAlpha } from './_watermark.mjs';

const SAMPLE = process.argv.includes('--sample');
const CONCURRENCY = 2;
const VIDEO_RE = /\.mp4$/i;
const IMG_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

// Eyeball these 6 multi-clip folders; override where natural-sort-first is wrong.
const CLIP_OVERRIDE = {
  // '#01': 'WhatsApp Video 2026-04-07 at 12.45.06 PM.mp4', // af.mp4 sorts first but is the wrong clip
  // '#37': '...mp4', '#44': '...mp4', '#86': '...mp4', '#88': '...mp4', '#03': '3.mp4',
};

// per folder starting with '#':
//   slug = slugByDisplay.get(folder); if (!slug) skip;
//   mp4s = readdirSync(dir).filter(VIDEO_RE.test).sort(natural);
//   if (!mp4s.length) skip;                       // photo-only listing -> media.sql owns it
//   pick = CLIP_OVERRIDE[folder] ?? mp4s[0];
//   hasPhotos = readdirSync(dir).some(IMG_RE.test);  // -> is_cover = hasPhotos ? 0 : 1
//   { ow, oh } = outputDims(srcPick);
//   mkWordmark(ow) -> /tmp/wm-<slug>.png; transcode -> tour.mp4; poster() -> renderSizes() -> 3 webp
//   upload tour.mp4 (ContentType 'video/mp4'); upload tour-{card,gallery,full}.webp (ContentType 'image/webp')
//   record { uuid: randomUUID(), w: ow, h: oh, isCover: !hasPhotos }
```

**Upload — `video/mp4` is required.** The media endpoint serves whatever content-type R2 stored at upload time (then overrides by extension — see §5). PUT the mp4 explicitly:

```js
await s3.send(new PutObjectCommand({ Bucket: 'rentoo-photos', Key: `properties/${slug}/tour.mp4`, Body: mp4Buf, ContentType: 'video/mp4' }));
```

### 4.7 `seed/video-media.sql` INSERT shape

One scoped `DELETE` + one `INSERT` per video listing, same 9 columns as photos:

```sql
-- generated by scripts/video-upload.mjs
DELETE FROM property_media WHERE kind='video' AND property_id = (SELECT id FROM properties WHERE slug='3bhk-apartment-iskon-temple-03');
INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked)
  SELECT '7f3c...-uuid', id, 'video', 'properties/3bhk-apartment-iskon-temple-03/tour', -1, 0, 480, 848, 1
  FROM properties WHERE slug='3bhk-apartment-iskon-temple-03';
-- is_cover=0 above (this listing has photos); a video-only folder emits is_cover=1.
```

Apply: `npx wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql`

---

## 5. Media Endpoint — Range / 206 Support

Replace `src/pages/media/[...key].ts` with the version below. It does a cheap `head()` first to get `.size`, validates the `Range` header *before* pulling a body, returns `206` for satisfiable ranges (including the iOS Safari `bytes=0-` probe), `416` for unsatisfiable ones, and `200` (with `Accept-Ranges: bytes`) otherwise. Content-Type is overridden by extension (`.mp4` → `video/mp4`, else `image/webp` — preserving today's behavior for all existing WebP keys). The hotlink check and `prerender=false` are preserved.

**Verified APIs** (Cloudflare R2 Workers API reference + local `@cloudflare/workers-types`):
- `R2GetOptions.range` takes an `R2Range` object (`{offset,length?}` | `{offset?,length}` | `{suffix}`) — not the raw header string. <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2getoptions>
- `R2Object.size`, `.range`, `.httpEtag`, `.writeHttpMetadata(headers)`; `head()` returns `R2Object | null`. <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2object-definition>
- R2 may return fewer bytes than requested for a ranged read, so we trust `obj.range` when computing `Content-Range`. <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAllowedReferer } from '../../lib/media';

export const prerender = false;

// Parsed, validated byte range against a known object size.
type ParsedRange =
  | { type: 'full' }
  | { type: 'range'; offset: number; length: number }
  | { type: 'unsatisfiable' };

/**
 * Parse a single-range `Range: bytes=...` header against the total object size.
 * Supports `bytes=start-end`, `bytes=start-` (open-ended), and `bytes=-suffix`.
 * Multi-range / malformed -> collapse to a full 200 (browsers send single ranges
 * for media; R2 cannot emit multipart/byteranges).
 */
function parseRange(header: string | null, size: number): ParsedRange {
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

function contentTypeFor(key: string, fallback: string): string {
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.webp')) return 'image/webp';
  return fallback;
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key; // e.g. "properties/<slug>/0-card.webp" or "properties/<slug>/tour.mp4"
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

> The `'body' in obj` guard is harmless/redundant (no `onlyIf` is passed, so a non-null `get()` is always an `R2ObjectBody`) but kept for clarity and the impossible-edge guard.

---

## 6. Gallery Video Slide + iOS Inline Playback

### 6.1 `src/components/Gallery.astro` (EDIT)

Add an optional `video?: { src; poster; alt }` prop. When present, the video is **slide 0**; photos shift to `1..n`. The slide model becomes "stage items": each thumb carries `data-kind` (`video`|`photo`) and `data-index`; `show(index)` reads `data-kind` and either reveals the `<video>` or reveals + crossfades the `<img>`. The crossfade (`main.src` swap) is **gated behind `kind === 'photo'`** so it never overwrites the video poster. Leaving slide 0 calls `video.pause()`; `video.play()` is **never** called programmatically (tap-to-play via native controls = a real user gesture, satisfying iOS inline/autoplay policy). iOS inline correctness: `playsinline` (no fullscreen takeover), `preload="none"` (poster shows, the multi-MB mp4 is not fetched until tap), `poster` = `tour-gallery.webp`, `controls` for the tap affordance.

**Frontmatter:**

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

**Stage markup** — insert the `<video>` before `<img data-gallery-main>`; hide the img when a video leads; counter denominator becomes `{slideCount}`:

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

> Use `src={hasVideo ? undefined : coverImg?.gallery}` (omit the attribute) rather than `src=""` to avoid a spurious request from a hidden `<img>`.

**Thumb strip** — prepend the video thumb, tag photo thumbs with `data-kind="photo"` and shifted `data-index`:

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

**Script** — `show()` branches on `data-kind`; crossfade is photo-only; `astro:page-load` + `data-galleryReady` re-init pattern preserved:

```html
<script>
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

**Styles** — keep the entire existing `<style>` block byte-for-byte; **append**:

```css
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

### 6.2 Detail-page wiring — `rent/[slug].astro` AND `commercial/[slug].astro` (EDIT)

In **both** files, after the existing `const images = media.filter(...).map(...)`, build `tourVideo`:

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

Add `videoUrl` to the existing media import: `import { mediaUrl, videoUrl } from '../../lib/media';`.

Then change the gallery/placeholder block:

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

The `rent` alt elsewhere uses `bhk_type ?? property_type` and `commercial` uses `property_type`; the `tourVideo` alt above is identical in both files (uses `display_id`), so it can be pasted verbatim.

> **Placeholder change:** "Photos coming soon" now shows only when there is **neither** a photo nor a video. The ~29 video-only listings stop showing the placeholder and render the tappable tour instead.

---

## 7. Output / Cost Estimate

Measured at CRF 24 on real inventory: 34s→5.3MB, 108s→14.9MB, 144s→17.0MB, static 333s→4.8MB, worst-case high-motion 333s `#86`→46.6MB. Corpus: 56 source clips / 5238s / avg 94s, but **one tour per listing = 49 tours**.

| Item | Estimate |
| --- | --- |
| 49 `tour.mp4` (avg ~12.8 MB) | ~630 MB avg-case |
| Worst-case 49 tours | ~720 MB |
| 49 × 3 poster WebPs (~12 KB ea) | ~1.8 MB |
| **Total R2 storage added** | **~630–720 MB** |
| % of R2 free-tier (10 GB) | ~6–7%, on top of existing photos |
| **Egress** | **$0** (Cloudflare R2 has zero egress) |

Comfortably within the free tier. If budget ever tightens, cap with `-maxrate 2M -bufsize 4M` or CRF 25 for clips > 4 min (not needed now).

---

## 8. Testing & Verification Plan

1. **`videoUrl` unit test** — add to existing `test/media.test.ts` (vitest, `vitest run`):

   ```ts
   import { mediaUrl, isAllowedReferer, videoUrl } from '../src/lib/media';
   describe('videoUrl', () => {
     test('appends .mp4 to base key', () => {
       expect(videoUrl('properties/3bhk-apartment-iskon-temple-03/tour'))
         .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour.mp4');
     });
     test('poster reuses mediaUrl on the same base key', () => {
       expect(mediaUrl('properties/3bhk-apartment-iskon-temple-03/tour', 'gallery'))
         .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour-gallery.webp');
     });
   });
   ```

2. **`astro check`** — type-check the new endpoint, helper, Gallery prop, and both detail pages.
3. **`npm run build`** — full SSR build must pass.
4. **`--sample` eyeball** — `node scripts/video-upload.mjs --sample`; open the local `tour.mp4` previews and posters. Confirm: portrait orientation, centered faint "Rentoo" wordmark matching the photo look, no black/sideways poster, plausible file sizes.
5. **`wrangler dev` smoke** (`npx wrangler dev` or `npm run preview`) after applying `seed/video-media.sql` locally:
   - Load a video-only detail page → gallery shows the poster with a ▶ thumb; tap plays **inline** (no fullscreen takeover on iOS / responsive emulation).
   - `curl -s -D - -o /dev/null -H 'Range: bytes=0-1' http://localhost:8787/media/properties/<slug>/tour.mp4` → **`HTTP/1.1 206`** with `Content-Range: bytes 0-1/<size>`, `Accept-Ranges: bytes`, `Content-Type: video/mp4`.
   - `curl` an unsatisfiable range (`bytes=<size>-`) → **`416`** with `Content-Range: bytes */<size>`.
   - Card grids: video-only listing renders its poster cover; no broken `<base>-card.webp` leak in any card carousel (attachPhotos kind filter).
6. **Re-run idempotency** — apply `seed/media.sql` then `seed/video-media.sql` (and vice versa); confirm both photo and video rows survive (scoped DELETEs).

---

## 9. Risks & Open Questions

**Risks (mitigated):**
- **iOS Safari 206 dependency** — without §5 the feature is dead on the primary target. This is now a first-class deliverable, not a footnote.
- **Rotation footgun** — 12/56 clips carry a `-90` display matrix on landscape coded dims. Mitigated by reading `stream_side_data=rotation`, swapping displayed dims, default autorotate, and probing the *transcoded* output for row dims.
- **attachPhotos leak / unscoped DELETE** — both fixed (§3.3, §3.4).
- **Poster 404** — the poster MUST be generated by `video-upload.mjs` (§4.4); `mediaUrl(v.r2_key,'gallery')` 404s until `tour-gallery.webp` exists. Gated by the pipeline running before the detail wiring is exercised.
- **Letterboxing** — `object-fit: contain` shows black bars around the vertical clip in the 3:2 stage; acceptable, matches "tap-to-play tour" framing.

**Open questions:**
1. **Multi-video folders (`#01,#03,#37,#44,#86,#88`):** which clip is the canonical tour for each? Natural-sort-first picks a reasonable default but at least `#01` likely needs a `CLIP_OVERRIDE`. Needs a human eyeball pass before the full upload run.
2. **"56 vs 49":** confirm one-tour-per-listing is the intended model (design says so). The 7 surplus clips are dropped, not concatenated.
3. **Lightbox/full view:** the spec wires `tour-full.webp` for parity but the current Gallery has no full-screen lightbox; is a future fullscreen video view wanted, or is inline-in-stage sufficient for v1? (Assumed sufficient.)
4. **Audio:** kept at AAC 96k, plays on tap. Confirm no requirement to mute/normalize WhatsApp audio.

---

## 10. Ordered File Create/Edit Checklist

1. **CREATE** `scripts/_watermark.mjs` — shared wordmark builder (constants, `loadWordmarkSvgs`, `setAlpha`, `makeWatermarkFactory`).
2. **EDIT** `scripts/watermark-upload.mjs` — import from `./_watermark.mjs` (remove inline copies); scope photo `DELETE` to `kind='photo'`.
3. **CREATE** `scripts/video-upload.mjs` — transcode+watermark+poster pipeline, `--sample`, concurrency 2, `CLIP_OVERRIDE`, emit `seed/video-media.sql`.
4. **EDIT** `src/lib/media.ts` — add `videoUrl()`.
5. **EDIT** `src/lib/db.ts` — `attachPhotos()` add `AND pm.kind = 'photo'`.
6. **REPLACE** `src/pages/media/[...key].ts` — Range/206 + 416 + HEAD endpoint.
7. **EDIT** `src/components/Gallery.astro` — `video?` prop, video slide 0, kind-gated `show()`, appended styles.
8. **EDIT** `src/pages/rent/[slug].astro` — import `videoUrl`, build `tourVideo`, update placeholder condition + `<Gallery video={tourVideo}>`.
9. **EDIT** `src/pages/commercial/[slug].astro` — same as step 8.
10. **EDIT** `test/media.test.ts` — add `videoUrl` describe block.
11. **GENERATE** `seed/video-media.sql` — produced by step 3's run; apply via `wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql`.
12. **VERIFY** — §8: `vitest run`, `astro check`, `npm run build`, `--sample` eyeball, `wrangler dev` 206/416 + inline-playback smoke.
