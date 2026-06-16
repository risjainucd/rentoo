# 2026-06-16 — Listings to D1, photos live, slideshow + card carousels

Branch: `milestone-1-dynamic`

## Goal

Take Rentoo live with real data: import the listings, get watermarked photos
onto R2, fix the broken logo, and make photos browsable both on detail pages
and straight from the grids.

## Listings import

`scripts/import-excel.mjs` reads `data/Rentoo data 2026.xlsx` and writes
`seed/properties.sql` (149 live listings + neighbourhoods) and
`seed/photos.json` (the `#NN` display-id -> slug map). Applied to D1 with
`wrangler d1 execute --remote`. Rows with zero rent are dropped as empty
placeholders.

## Photos: watermark + upload pipeline

The photos arrived as local folders (`inventory 2026/#01 .. #93`), each named
by listing display-id and mixing images with the occasional `.mp4`.

Built `scripts/watermark-upload.mjs`:

- Maps each `#NN` folder to a slug via `seed/photos.json`.
- Filters to images, sorts by filename so the first becomes the cover.
- Stamps a **centered faint white "Rentoo" wordmark** with a soft shadow. The
  brand mark is navy, which vanishes on dark photos, so the watermark is
  recolored white with a blurred dark shadow underneath. It reads on both
  bright walls and dark rooms.
- Renders three WebP sizes (`card` 600w, `gallery` 1200w, `full` 2000w) and
  uploads each to R2 via `@aws-sdk/client-s3`.
- Emits `seed/media.sql` (idempotent DELETE + INSERT of `property_media` rows).
- `--sample` mode writes a few local previews so the watermark can be eyeballed
  before any upload.

Result: 705 photos across 64 listings, 2,115 R2 objects.

### Decisions and gotchas

- **Upload via R2 S3 API, not the wrangler CLI.** `@aws-sdk/client-s3` with an
  R2 token uploads 2,000+ objects in parallel in minutes; per-object
  `wrangler r2 object put` would have taken far longer.
- **Panorama bug.** One wide, short photo in `#87` failed with "Image to
  composite must have same dimensions or smaller" because the watermark was
  taller than the image. Fixed by clamping the watermark to fit inside the
  photo (92% of the smaller dimension) before compositing, then re-ran. The
  re-run is idempotent (same keys), so it just overwrote and produced a clean
  `media.sql`.
- **Coverage.** 64 of 149 listings got galleries. 29 folders were video-only
  (no stills). Commercial listings had no photo folders. Those gaps are the
  outstanding content work.

## Logo 404 fix

The header, footer, and favicon pointed at `/Rentoo.png` and `/Rentooicon.png`,
which all returned 404 live. Root cause: Astro only serves root assets from
`public/`, but the logo files were sitting in the repo root and never made it
into the build. Fix: created `public/` with the logo assets (PNG + SVG),
rebuilt, redeployed. All now return 200 and the brand mark renders site-wide.

## Detail-page slideshow

Turned `Gallery.astro` into a carousel: overlaid previous/next arrows on the
main image, wrap-around navigation, a position counter, keyboard arrows, and a
thumbnail strip that stays in sync. Single-photo galleries hide the controls.
Vanilla JS, scoped per `[data-gallery]`, using the existing design tokens.

## Inline carousel on listing cards

The bigger one: let users flip through a listing's photos from the home page
and every grid without opening it.

- **Data layer.** Cards previously loaded only the cover (`is_cover = 1`). Added
  `attachPhotos()` in `db.ts`: one batched `IN` query loads each card's full
  ordered photo list, wired into both `listListings` and `featuredListings`, so
  all four grid pages get it transparently. `ListingCard` gained
  `photos?: string[]`.
- **Component.** `PropertyCard` got hover previous/next arrows + a photo counter
  over the cover, lazy `src`-swap with wrap-around. Only the cover image loads
  up front; navigating fetches the next on demand.
- **Stretched-link trick.** A `<button>` cannot be nested inside an `<a>`, and
  the whole card needs to stay clickable. So the card link uses a `::after`
  overlay that covers the card (z-index 1), and the arrow buttons sit above it
  (z-index 2) with `preventDefault` + `stopPropagation`. Click the photo and you
  open the listing; click an arrow and you only change the photo. Decorative
  pills are `pointer-events: none` so they pass clicks through too.

### Verification gotchas

- A first post-deploy check of the home page showed zero carousels: a stale
  edge node mid-deploy. Seconds later it was consistent (6/6 featured cards had
  full photo arrays).
- Grep counts looked off-by-one across pages because the bundled inline script
  contains the `[data-card-prev]` selector string, so it matched once per page
  on top of the real buttons. Subtracting it, the counts were exactly right:
  home 6/6, `/rent` 9/12 (three have no photos), `/commercial` 0 (no commercial
  photos).

## State at end of session

149 listings + 64 photo galleries live, logo rendering, photo browsing on both
detail pages and grids. Outstanding: stills for the 29 video-only listings and
photos for commercial listings.
