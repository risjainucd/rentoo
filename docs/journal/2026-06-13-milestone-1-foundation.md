# 2026-06-13 — Milestone 1 foundation: dynamic site on Cloudflare

Branch: `milestone-1-dynamic`

## Goal

Turn the static Rentoo site into a dynamic, database-backed catalog, and pick a
hosting + data stack that can serve real listings and photos.

## What was built

- **Astro app, server output.** Scaffolded Astro at the repo root with
  `output: 'server'` and the `@astrojs/cloudflare` adapter (platform proxy on
  for local bindings). Added React 19 for islands, Tailwind v4, and shadcn/ui +
  Base UI themed to the existing Rentoo brand tokens.
- **Domain + data layer, test-first.** Built the pure pieces with TDD: domain
  types and media URL/referer helpers, the listings query builder + card
  mapper, slug / display-id helpers, and the row-to-Property mapping. A Vitest
  harness backs all of it.
- **D1 schema.** `migrations/0001_init.sql` defines `neighbourhoods`,
  `properties`, and `property_media`. The media table stores a base R2 key and
  defers the size suffix to read time.
- **R2 image endpoint.** `/media/[...key].ts` streams objects from R2, guarded
  to same-origin referers, with a one-year immutable cache.
- **SSR pages.** Home (featured), `/rent` and `/commercial` grids with
  server-side filters and pagination, listing detail pages, per-neighbourhood
  grids, and the listing detail gallery (vanilla JS). Plus the site shell:
  header + mobile nav island, footer, section markers, pills, PropertyCard.
- **Static pages.** About, Contact (with a contact dialog island), Privacy, and
  a custom 404.

## Decisions

- **Stack pivot to Cloudflare.** The original design spec leaned on Supabase;
  the build pivoted to Cloudflare D1 + R2 + Workers so data, images, and the
  app live on one platform with one deploy. The plan doc was updated to match
  (`docs(plan): pivot deploy to Cloudflare Workers`).
- **Keep interactivity cheap.** Only the genuinely interactive parts are React
  islands; galleries and nav use small vanilla-JS scripts.

## State at end of session

A complete dynamic site shell rendering from D1, deployable to Cloudflare
Workers. No real listing data or photos yet. That came next.
