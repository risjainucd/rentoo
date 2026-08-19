# Rentoo

Curated rental listings for Jaipur. A dynamic, server-rendered catalog of hand-verified residential and commercial properties, with watermarked photos and WhatsApp-first contact.

Live: https://rentoo.rentojaipur.workers.dev

## Stack

- **Astro 6** with `output: 'server'` (SSR) on **Cloudflare Workers** via `@astrojs/cloudflare`.
- **React 19** islands for interactive bits (filters, mobile nav, contact dialog); everything else is static Astro + a little vanilla JS.
- **Cloudflare D1** (`rentoo-listings`) for listing data, **R2** (`rentoo-photos`) for images, **KV** (`SESSION`) reserved for sessions.
- **Tailwind v4** + shadcn/ui + Base UI, themed to Rentoo brand tokens.
- **TypeScript**, **Vitest** for unit tests.

Worker bindings (see `wrangler.jsonc`): `DB` (D1), `MEDIA` (R2), `SESSION` (KV), plus `ASSETS` and `IMAGES` provided by the adapter.

## Project layout

```
src/
  components/        PropertyCard, Gallery, FeaturedHero, SiteHeader/Footer, Pill, ui/*
  layouts/           BaseLayout.astro
  lib/               db.ts, sql.ts, types.ts, media.ts, site.ts (domain + data access)
  middleware.ts      attaches D1 binding + siteOrigin to Astro.locals
  pages/
    index.astro                home (featured listings)
    rent/ commercial/          grid index + [slug] detail (SSR)
    neighbourhoods/[slug]       per-area grid
    media/[...key].ts           R2 image endpoint (referer-guarded, immutable cache)
    about/contact/privacy/404
migrations/          0001_init.sql  (D1 schema)
scripts/             import-excel.mjs, watermark-upload.mjs, lib/transform.ts
public/              logo assets served at site root (Rentoo.png/.svg, Rentooicon.*)
test/                vitest unit tests (transform, sql, media, smoke)
docs/                superpowers plan + spec, and docs/journal/ devlog
```

`inventory 2026/`, `data/`, and `seed/` hold local-only inputs and generated SQL; they are gitignored.

## Data model

Three tables (`migrations/0001_init.sql`):

- **`neighbourhoods`** — slug, name, display order, optional cover.
- **`properties`** — listing core: `display_id` (`#01`), segment (residential/commercial), bhk/type, rent, area, furnishing, status, neighbourhood, map URL, description, url `slug`, `published`.
- **`property_media`** — one row per photo: `r2_key` base (`properties/<slug>/<n>`), `display_order`, `is_cover`, dimensions, `watermarked`.

## Media pipeline

Two scripts turn a spreadsheet + photo folders into live, watermarked listings.

**1. Import listings** (`scripts/import-excel.mjs`): reads `data/Rentoo data 2026.xlsx`, normalizes rows, and writes `seed/properties.sql` (listings + neighbourhoods) and `seed/photos.json` (the `#NN` -> slug map used by the photo step). Apply with `wrangler d1 execute`.

```bash
npx tsx scripts/import-excel.mjs
npx wrangler d1 execute rentoo-listings --remote --file=seed/properties.sql
```

**2. Watermark + upload photos** (`scripts/watermark-upload.mjs`): maps `inventory 2026/#NN` folders to slugs via `seed/photos.json`, stamps a centered faint white "Rentoo" wordmark, renders `card` / `gallery` / `full` WebP sizes, uploads them to R2, and writes `seed/media.sql`.

```bash
# Preview the watermark on a few photos without uploading:
node scripts/watermark-upload.mjs --sample

# Full run (needs R2 S3 credentials):
R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node scripts/watermark-upload.mjs
npx wrangler d1 execute rentoo-listings --remote --file=seed/media.sql
```

**Read path:** the DB stores the base key `properties/<slug>/<n>`; the app appends a size suffix at render time (`mediaUrl(key, size)` -> `/media/properties/<slug>/<n>-<size>.webp`). The `/media/[...key].ts` route streams the object from R2, gated to same-origin referers, with a one-year immutable cache.

## Local development

```bash
npm install
npm run dev      # astro dev with the Cloudflare platform proxy (local D1/R2/KV)
```

Local D1/R2 start empty. To work with real data locally, apply the seed SQL with the `--local` flag and note that local R2 has no images (so `/media/*` will 404 locally).

## Deploy

The Cloudflare adapter generates the deploy config at build time, so deploying is two commands:

```bash
npm run build
npx wrangler deploy
```

`npm run build` emits the worker to `dist/server` and static assets to `dist/client`; `wrangler deploy` reads `.wrangler/deploy/config.json` and ships both. Anything in `public/` is served at the site root.

## Testing

```bash
npm test     # vitest run
```

Covers the import transforms, the listings query builder + card mapper, and the media URL/referer helpers.

## Data status (milestone 1)

149 live listings. 64 have watermarked photo galleries (705 photos); 29 folders were video-only (no stills imported); commercial listings have no photos yet. See `docs/journal/` for the full history.
