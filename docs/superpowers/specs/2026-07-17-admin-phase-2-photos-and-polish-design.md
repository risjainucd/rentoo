# Admin Phase 2 — In-portal photo management + design-system polish

Date: 2026-07-17 · Branch: `milestone-1-dynamic` · Live: **https://rentoo.in**

Two coupled deliverables for the `/admin` portal:

1. **Photo management** — an authenticated admin can add, delete, and reorder a listing's
   photos directly in the portal (watermarked in the browser, stored in R2), replacing the
   offline `scripts/watermark-upload.mjs` pipeline for day-to-day edits.
2. **Design-system polish** — restyle the whole admin portal (`/admin` list + `/admin/[slug]`
   editor) to match the public site's design system instead of the current off-brand inline styles.

Both ship together because the new photo UI must be built against the polished tokens, not the
old inline styles.

---

## Background / current state

- **Auth** is done: `src/middleware.ts` guards `/admin*` and `/api/admin*` via Cloudflare Access
  JWT (`src/lib/admin-auth.ts`) + an `ADMIN_EMAILS` allowlist. Fails closed. All new routes live
  under `/api/admin/*`, so they inherit this protection with no extra work.
- **R2 is directly bound** to the Worker as `MEDIA` (bucket `rentoo-photos`) in `wrangler.jsonc`.
  The Worker can `put()`/`delete()` objects with no S3 credentials — credentials are only needed
  by the *offline* `scripts/*.mjs`, never at runtime.
- **Media serving** is `src/pages/media/[...key].ts` (referer-checked, Range/206 aware). Unchanged.
- **Storage convention**: renditions live at `properties/<slug>/<id>-{card,gallery,full}.webp`
  (widths 600 / 1200 / 2000). `property_media` rows carry a **base** `r2_key`
  (`properties/<slug>/<id>`); the size suffix is appended at read time by `mediaUrl()`.
- **`property_media` schema** (migrations/0001) already has every column we need:
  `id, property_id, kind, r2_key, display_order, is_cover, width, height, watermarked`.
  **No migration is required.**
- **Cover semantics** (existing): the site treats **`display_order` 0 as the cover**
  (`attachPhotos` in `db.ts` takes `photos[0]` as `cover_key`); `setCover` just pins the chosen
  photo to `display_order 0`. This lets us unify "reorder" and "pick cover" into one operation.
- **Watermarking** currently runs offline with `sharp` (a native binary that cannot run in a
  Cloudflare Worker). The shared wordmark builder is `scripts/_watermark.mjs`
  (white wordmark at 0.6× image width, α 0.18, plus a blurred dark shadow at α 0.22, offset).

### Why the admin looks off-brand

`src/pages/admin/index.astro` and `src/pages/admin/[slug].astro` are standalone `<html>`
documents with inline `<style>` blocks and hardcoded grays (`#f8fafc`, `#e5e7eb`, `system-ui`,
bootstrap-y blue/amber pills). They never import `styles/globals.css`, so none of the site's
tokens, fonts (Geist Variable + Space Grotesk), radii, shadows, or focus/polish styles apply.

---

## Decisions (locked)

1. **Scope: full manage** — add + delete + reorder. (Not add-only.)
2. **Engine: client-side (browser Canvas)** — the admin's browser resizes, watermarks, and
   WebP-encodes; the Worker only validates + writes. No `sharp`, no WASM, no Cloudflare Images,
   no new paid product, no change to the `/media` serving path.
3. **Cover = first photo (unified).** Reorder is the single ordering operation; position 0 is the
   cover. This **replaces** the separate radio cover-picker in the editor.
4. **HEIC not supported client-side.** Desktop browsers can't decode iPhone HEIC/HEIF in Canvas.
   The client rejects HEIC/HEIF with a clear "export as JPEG first" message. JPEG/PNG/WebP accepted.
5. **`r2_key` is a permanent opaque id; `display_order` is the sole ordering source of truth.**
   New uploads get a random key segment so reordering never renames R2 objects. Existing seeded
   keys (`properties/<slug>/0`, `/1`, …) are grandfathered — their numeric suffix simply becomes
   an opaque token.

---

## Part 1 — Photo management

### 1.1 Upload flow (per photo, in the browser)

1. Admin selects/drops files in the editor's photo panel.
2. For each file the client:
   - Rejects HEIC/HEIF and anything that fails to decode; caps absurd dimensions.
   - Decodes the image (`createImageBitmap`), then renders three WebP renditions via
     `<canvas>` + `canvas.toBlob('image/webp', q)`:
     **card 600w (q≈0.72), gallery 1200w (q≈0.80), full 2000w (q≈0.82)** — `withoutEnlargement`
     semantics (never upscale past the source width).
   - Draws the **Rentoo wordmark** centered on each rendition, ported from `_watermark.mjs`:
     white wordmark at 0.6× rendition width (min 80px), α 0.18, with a soft dark drop-shadow
     (blur + offset, α 0.22), clamped to fit inside the photo. Rendered from `/Rentoo.svg`
     loaded once as an `Image`.
   - Records the natural gallery-size `width`/`height` for the DB row (matches the offline
     pipeline, which stores gallery-rendition dims).
3. Client POSTs the three blobs + `width`/`height` as `multipart/form-data` to
   `POST /api/admin/photos/[slug]`.
4. The Worker validates, `put()`s all three renditions to R2, inserts one `property_media` row,
   and returns `{ id, r2_key, display_order }`. The client appends the new tile to the grid.

The watermark drawing lives in **`src/lib/watermark-canvas.ts`** (browser module, imported by the
editor's client `<script>`). It is a faithful Canvas port of `_watermark.mjs` — the same visual
result, a different engine. **Fidelity is the one real risk**: verify Canvas output against a
sample from the sharp pipeline before calling it done.

### 1.2 API (all under `/api/admin/*`, already Access-protected)

- **`POST /api/admin/photos/[slug]`** — `multipart/form-data`: fields `card`, `gallery`, `full`
  (webp blobs) + `width`, `height`. Validates: listing exists; each blob is `image/webp` and
  within a sane size cap. Generates base key `properties/<slug>/u-<8hex>`, `put()`s the three
  `-{size}.webp` objects, inserts a `property_media` row with `kind='photo'`, `watermarked=1`,
  `display_order = (max for this listing) + 1`, `is_cover=0`. Returns the new row summary as JSON.
  **Order of operations:** put all three objects first, then insert the row — a failed put never
  leaves an orphaned DB row.
- **`POST /api/admin/photos/[slug]/reorder`** — JSON `{ ids: string[] }` (full ordered list of
  this listing's photo ids). Rewrites `display_order` to the array index for each id and sets
  `is_cover=1` on index 0, `0` on the rest, in one batched `db.batch(...)`. Ignores ids that
  don't belong to the listing.
- **`POST /api/admin/photos/[slug]/delete`** — JSON `{ id }`. Deletes the `property_media` row and
  `bucket.delete()`s its three renditions. If the deleted photo was `display_order 0`, promotes the
  next photo to cover (re-run the same normalize-order logic as reorder over the remaining ids).

All three return JSON (`{ ok: true, ... }` / `{ ok: false, error }`) and appropriate status codes.

### 1.3 New `db.ts` helpers

- `addPhoto(db, slug, { r2_key, width, height }): Promise<PropertyMedia>` — insert at
  `max(display_order)+1`, `kind='photo'`, `watermarked=1`, returns the row.
- `deletePhoto(db, slug, id): Promise<string[]>` — delete the row, return the base `r2_key`(s) the
  caller must remove from R2, and renormalize remaining `display_order`/`is_cover`.
- `reorderPhotos(db, slug, ids): Promise<void>` — set `display_order = index`, `is_cover = index===0`.

These wrap D1 `prepare/bind/batch`; they own the `display_order`/`is_cover` invariant so routes
stay thin. The existing `setCover` becomes redundant for the new UI but stays for back-compat.

### 1.4 Data-model invariants

- `display_order` values for a listing's photos are `0..n-1`, contiguous, unique.
- Exactly one photo has `is_cover=1` (the one at `display_order 0`) when the listing has ≥1 photo.
- `r2_key` is never mutated after insert. Reorder/delete touch only `display_order`/`is_cover`.

---

## Part 2 — Admin design-system polish

### 2.1 `AdminLayout.astro` (new)

A dedicated admin layout — **not** `BaseLayout` (admin must not carry the public header/footer,
contact dialog, or scroll-reveal). It:

- `import '../styles/globals.css'` → Geist Variable body, Space Grotesk display, paper palette,
  radii, shadows, focus-clay ring, `.btn-sheen`.
- Renders `<!doctype html>` + `<head>` with `<meta robots noindex,nofollow>`, viewport, favicon
  (`/Rentooicon.png`), and `<title>` from a prop.
- Renders a **slim admin top-bar**: Rentoo wordmark (`/Rentoo.svg`) + an "Admin" tag on navy
  (`--color-primary` / `--color-primary-foreground`), signed-in email on the right; an optional
  `back` prop renders a "← All listings" link on the editor page.
- Props: `{ title: string; email?: string | null; back?: boolean }`.

Both admin pages are converted to use `<AdminLayout>` and drop their inline `<style>` doc scaffolding.

### 2.2 Listings table (`index.astro`)

Rebuilt on tokens: paper background, `--color-surface-card` table with `--shadow-elev1` and token
radii, Space Grotesk uppercase column headers, hover rows. Segment + status pills reuse the site's
exact color pairs — **navy / green / terracotta** (replacing the current blue/amber bootstrap
tints): e.g. residential → haze/navy, commercial → ok-mist/green, industrial → accent-mist/terracotta;
status available → green, rented → danger-red, on-hold → amber. The media column shows a clear
**"needs photos"** cue for listings with 0 photos so gaps are visible at a glance. "Edit" and
"view ↗" actions restyled as themed links/buttons.

### 2.3 Editor (`[slug].astro`)

Rebuilt to match: form fields styled like the site's inputs (`--color-input` bg, `--color-border`,
focus-clay ring, token radii), Space Grotesk field/section labels, a navy primary "Save changes"
button with `.btn-sheen`, and the green saved-toast using `--color-ok-mist`. The photo panel (2.4)
replaces the old radio cover-picker. No change to the existing field set, the save POST handler, or
`updateListingFields` behavior beyond removing the now-redundant `cover` radio (cover is set via
photo order instead).

### 2.4 Photo panel (the Part-1 UI, themed from the start)

Inside the editor, a single **ordered, drag-reorderable grid**:

- Each tile shows the `card` rendition, a **"Cover"** badge on position 0, and a **× delete**
  button (with confirm). Tiles are draggable to reorder (pointer/drag events; a simple, dependency-
  free implementation). Drag to front = new cover.
- A **drop-zone / file input** below the grid accepts multiple files, shows **per-file progress**
  (encoding → uploading → done/error), and appends successful uploads as new tiles.
- All operations are **AJAX against the Part-1 endpoints** and reflect immediately (no full-page
  reload). Reorder and delete are **optimistic with revert-on-error**; a failed upload surfaces a
  per-file error without blocking the rest of the batch.
- Themed entirely with site tokens so it reads as native, not bolted on.

---

## Error handling

- **Client:** reject HEIC/HEIF and non-decodable files with a clear message; guard against
  zero-byte / oversized files; never let one failed file abort the batch; disable the drop-zone
  while a batch is in flight to avoid dup submits.
- **Upload endpoint:** 404 if the slug doesn't resolve; 400 if a part is missing or not
  `image/webp` or exceeds the size cap; put all three renditions before the DB insert so a partial
  R2 failure can't orphan a row; return a JSON error the client can show.
- **Reorder/delete:** ignore ids that aren't the listing's; keep the `display_order`/`is_cover`
  invariant in the db helper (single source of truth); delete removes R2 objects best-effort and
  still returns ok if the row is gone (R2 delete is idempotent).

## Testing (vitest, matching `test/media.test.ts` / `test/range.test.ts` style)

- **watermark-canvas**: rendition target widths + never-upscale behavior; watermark clamped inside
  the photo for wide/short inputs. (DOM/canvas exercised via the test environment or a thin unit
  around the sizing math.)
- **reorder invariant**: after `reorderPhotos`, `display_order` is `0..n-1` and exactly the index-0
  row has `is_cover=1`.
- **delete invariant**: `deletePhoto` removes the row, returns the R2 base key(s), and renormalizes
  remaining order + cover; deleting the cover promotes the next photo.
- **upload endpoint**: rejects non-webp / missing parts / unknown slug; on success inserts one row
  at `max+1` and reports the three expected R2 keys.
- Manual verification: watermark visual parity vs. a `--sample` from the sharp pipeline; end-to-end
  add/delete/reorder on the real Worker (`wrangler dev -c dist/server/wrangler.json`, **not**
  `astro dev` — middleware doesn't run for `/admin` under astro dev).

---

## Out of scope / follow-ups

- HEIC decoding (would need a WASM decoder or Cloudflare Images) — admin exports JPEG for now.
- A public `/favourites` page, `featured` bulk-setting, and the 26 unmapped neighbourhood tags
  remain separate open follow-ups (unchanged by this work).
- The offline `scripts/watermark-upload.mjs` pipeline stays as the bulk-import path; Phase 2 is for
  incremental in-portal edits, not the initial 64-listing seed.

## Files touched (anticipated)

- **New:** `src/layouts/AdminLayout.astro`, `src/lib/watermark-canvas.ts`,
  `src/pages/api/admin/photos/[slug].ts`, `src/pages/api/admin/photos/[slug]/reorder.ts`,
  `src/pages/api/admin/photos/[slug]/delete.ts`, tests under `test/`.
- **Edited:** `src/pages/admin/index.astro`, `src/pages/admin/[slug].astro`, `src/lib/db.ts`
  (add `addPhoto`/`deletePhoto`/`reorderPhotos`).
- **Unchanged:** `src/middleware.ts`, `src/pages/media/[...key].ts`, `wrangler.jsonc`,
  migrations, the offline scripts.
