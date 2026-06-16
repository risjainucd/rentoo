# Changelog

All notable changes to Rentoo are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are YYYY-MM-DD.

## [Milestone 1] - 2026-06-16

The first dynamic release: the static site became a live, database-backed
catalog with real listings and watermarked photos on Cloudflare.
Live at https://rentoo.rentojaipur.workers.dev.

### Added

- **Dynamic catalog.** Browse 149 hand-verified Jaipur listings rendered
  server-side from Cloudflare D1: a home page of featured listings, `/rent`
  and `/commercial` grids with server-side filters (neighbourhood, BHK,
  furnishing, rent range) and pagination, per-neighbourhood pages, and a
  detail page for every listing.
- **Real photos, watermarked.** 64 listings now show photo galleries (705
  images). Every photo carries a centered faint "Rentoo" wordmark and is
  served as WebP from R2 in three sizes (card / gallery / full) through a
  same-origin-guarded `/media` endpoint with a one-year immutable cache.
- **Photo slideshow on detail pages.** Step through a listing's photos with
  on-image previous/next buttons, a position counter, keyboard arrows, and a
  synced thumbnail strip.
- **Inline photo carousel on listing cards.** Flip through a listing's photos
  straight from the home page and every grid, without opening the listing.
  Clicking the card still opens the detail page; the arrows only change the
  photo. Controls hide for single-photo cards and stay visible on touch.
- **Spreadsheet-to-database importer** (`scripts/import-excel.mjs`) that turns
  `Rentoo data 2026.xlsx` into listing + neighbourhood SQL and a photo-folder
  map.
- **Watermark + upload pipeline** (`scripts/watermark-upload.mjs`) that
  watermarks local photos, renders the three WebP sizes, uploads them to R2,
  and emits the `property_media` rows. Run with `--sample` to preview the
  watermark before a full upload.
- **Static pages:** About, Contact (with a WhatsApp contact dialog), Privacy,
  and a custom 404.
- **Project documentation:** this CHANGELOG, a README, and a dated devlog
  under `docs/journal/`.

### Fixed

- **Header, footer, and favicon logo no longer 404.** Logo assets were sitting
  in the repo root where Astro never bundles them; moved into `public/` so the
  brand mark renders site-wide.

### Infrastructure

- Rebuilt the site on Astro 6 (SSR) + Cloudflare Workers via `@astrojs/cloudflare`,
  with React 19 islands and Tailwind v4 themed to brand tokens.
- D1 schema migration (`neighbourhoods`, `properties`, `property_media`),
  Cloudflare bindings (D1 / R2 / KV) in `wrangler.jsonc`, and a Vitest unit
  suite covering import transforms, the listings query builder, and media
  helpers.

### Known gaps

- 29 listings had video-only source folders, so they have no still photos yet.
- Commercial listings have no photos imported.
- Listing covers are the first photo by filename; manual cover/order selection
  is deferred to a future admin.
