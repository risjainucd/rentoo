# Rentoo Milestone 1 — Dynamic public site + real photos on Cloudflare

**Date:** 2026-06-13
**Status:** Design approved (pending written-spec review)
**Owner:** rishabhucd@gmail.com

## 1. Goal

Take the current static HTML prototype live as a **dynamic** site on **Cloudflare**,
with **real, watermarked listing photos**. Listings and neighbourhoods render from a
database instead of being hand-coded, and photos are served from object storage instead
of `picsum.photos` placeholders. Ship to `rentoo.pages.dev` first; a custom domain comes
in a later slice.

This is **sub-project 1 of ~5** (see §13). It deliberately excludes the admin panel,
auth, inquiry writes, WhatsApp automation, and analytics.

### Success criteria
- `rentoo.pages.dev` serves the full public site, visually matching the current design.
- The listing index (`/rent`), listing detail (`/rent/[slug]`), commercial, and
  neighbourhood pages render from **Cloudflare D1** (no hand-coded listing HTML remains).
- Listing photos are **real, watermarked images served from Cloudflare R2** (no
  `picsum.photos`).
- Filtering on the listing index works (neighbourhood, segment, BHK, price, furnishing).
- Lighthouse performance stays high — public pages ship little or no JS except where an
  interactive island is genuinely required.
- Re-running the import/seed scripts is idempotent (no duplicate listings or photos).

### Non-goals (this milestone)
Admin UI, authentication, owner records, inquiry/contact writes to the DB, WhatsApp bots,
GA4 analytics, custom domain, on-the-fly Cloudflare image transforms, video media.

## 2. Decisions on record

| Decision | Choice | Notes |
|---|---|---|
| Framework | **Astro** (whole-site rebuild) | `output: 'server'` + per-route `prerender` |
| Host | **Cloudflare Pages** | git integration from `risjainucd/rentoo` |
| Data | **Cloudflare D1** (SQLite) | native, no external service |
| Photos | **Cloudflare R2** | pre-watermarked, pre-sized derivatives |
| UI system | **Tailwind v4 + shadcn/ui + Magic UI** | themed to existing tokens |
| Deploy method | **Git integration** | push to `main` → auto build + deploy |
| Image serving | **Pre-sized derivatives + Astro `/media` endpoint** | referer-checked; CDN transforms deferred |
| Listing data source | **Excel spreadsheet** → import script | |
| Photo source | **One folder per listing** | first/marked photo = cover |
| Catalog size | **~50–500 listings** | LIMIT/OFFSET pagination now; keyset later |
| Domain | **`rentoo.pages.dev`** for now | custom domain in a later slice |

**Palette correction:** the live design tokens are navy `#082746`, sandstone paper
`#FAF7EE` (dominant surface — *not* white), terracotta `#B5532E` (signature accent),
green `#16A34A`. The `#0a6b2f` green that appears in `preview/architecture.html` was a
draft value and is superseded by the real `--ok-green: #16A34A` token from `styles.css`.

## 3. Architecture

```
Browser
  │
  ▼
Cloudflare Pages  ── Astro 6, output:'server', @astrojs/cloudflare adapter
  ├─ prerendered (static):     /  /about  /contact  /privacy  404
  ├─ SSR from D1:              /rent  /rent/[slug]  /commercial  /commercial/[slug]
  │                            /neighbourhoods/[slug]
  └─ /media/[...key]           ──▶ R2 binding (MEDIA): stream watermarked photo,
                                    long cache headers, Referer check
  Bindings: DB (D1) · MEDIA (R2) · compatibility_flags: ["nodejs_compat"]
```

- **Rendering split:** marketing/content pages are prerendered at build for cacheable
  speed; listing-bearing pages render on demand from D1, so the site is genuinely dynamic
  and ready for the admin milestone to mutate data without rebuilds.
- **Islands:** the site is ~95% static HTML. React (shadcn / Magic UI) is hydrated only
  where there is real interactivity (see §8). Static content ships zero JS.
- **Bindings access:** read `DB` and `MEDIA` from `Astro.locals.runtime.env`, wrapped in
  typed helpers in `src/lib/db.ts`. `platformProxy.enabled: true` provides the same
  bindings under `astro dev` locally.

## 4. Data model (D1 / SQLite)

Public-read subset of the architecture doc, adapted Postgres → SQLite (uuid→TEXT,
enum→TEXT+CHECK, jsonb→TEXT, bool→INTEGER). `owners`, `inquiries`, `audit_log` are
deferred to the admin slice.

```sql
-- migrations/0001_init.sql
CREATE TABLE neighbourhoods (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 0,
  cover_r2_key      TEXT,
  short_description TEXT
);

CREATE TABLE properties (
  id                TEXT PRIMARY KEY,                 -- uuid (generated at import)
  display_id        TEXT NOT NULL UNIQUE,             -- "#01"
  segment           TEXT NOT NULL CHECK (segment IN ('residential','commercial')),
  bhk_type          TEXT,                             -- "2BHK" (residential only)
  property_type     TEXT NOT NULL,                    -- apartment | office | shop | ...
  rent_inr          INTEGER NOT NULL,
  area_sqft         INTEGER,
  furnishing        TEXT CHECK (furnishing IN ('furnished','semi-furnished','unfurnished')),
  status            TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available','rented','on-hold')),
  landmark          TEXT,
  neighbourhood_slug TEXT NOT NULL,
  map_url           TEXT,
  description       TEXT,
  slug              TEXT NOT NULL UNIQUE,             -- url slug
  published         INTEGER NOT NULL DEFAULT 0,       -- 0/1
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (neighbourhood_slug) REFERENCES neighbourhoods(slug)
);
CREATE INDEX idx_props_nbhd      ON properties(neighbourhood_slug);
CREATE INDEX idx_props_segment   ON properties(segment);
CREATE INDEX idx_props_published ON properties(published);
CREATE INDEX idx_props_status    ON properties(status);

CREATE TABLE property_media (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video')),
  r2_key        TEXT NOT NULL,            -- BASE key "properties/<slug>/<n>"; size suffix (-card/-gallery/-full.webp) appended at read time
  display_order INTEGER NOT NULL DEFAULT 0,
  is_cover      INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  watermarked   INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX idx_media_property ON property_media(property_id);
CREATE INDEX idx_media_cover    ON property_media(property_id, is_cover);
```

**Query notes.** Filtered listing queries always constrain `published = 1`. The card grid
fetches the cover with a `LEFT JOIN property_media … AND is_cover = 1` to avoid an N+1.
Pagination uses `LIMIT/OFFSET` (fine under 500 rows); switch to keyset (`WHERE created_at
< ?`) only if the catalog outgrows that. SQLite foreign keys are advisory unless
`PRAGMA foreign_keys=ON`; integrity is also enforced app-side in the import script.

## 5. Photos — pipeline and serving

### Seed pipeline — `scripts/seed-photos.js` (one-off Node script)
1. Walk `data/listings/<slug>/` (one folder per listing); sort files; first (or a
   `*-cover.*`) = cover.
2. **Watermark with `sharp`**: composite `assets/watermark.png` (derived from
   `Rentooicon.png`) bottom-right, low opacity, baked into pixels.
3. Generate **2–3 WebP derivatives** per photo: `card` (~400w), `gallery` (~1000w),
   `full` (~1600w). Capture width/height.
4. Upload to R2 via the **S3-compatible API** (`@aws-sdk/client-s3`) under
   `properties/<slug>/<n>-<size>.webp`.
5. Emit `property_media` rows (as SQL, merged into the seed step in §6).
6. **Idempotent:** skip keys that already exist (or `--force` to delete+re-upload).

### Serving — `src/pages/media/[...key].ts`
Astro endpoint reads `Astro.locals.runtime.env.MEDIA.get(key)`, streams the body with
`Cache-Control: public, max-age=31536000, immutable` and the right `Content-Type`, and
rejects requests whose `Referer` is off-site (basic hot-link block). Because derivatives
are pre-sized, no runtime transform is needed. Components reference `/media/properties/
<slug>/<n>-card.webp` etc., always with explicit `width`/`height` to avoid CLS, `loading
="lazy"` on cards, eager on the detail hero.

### Upgrade path (later slice)
When a domain is on Cloudflare: add an R2 **custom domain** (`images.rentoo.in`), enable
**WAF Hotlink Protection**, and use `/cdn-cgi/image/` transforms for responsive sizing.
Watermarking stays at seed time (transforms cannot watermark).

## 6. Listing data import — `scripts/import-excel.js` (one-off Node script)

1. Read the spreadsheet with **SheetJS**, installed from the **CDN tarball**
   (`https://cdn.sheetjs.com/xlsx-0.20.3/...`) — *not* the stale, CVE-bearing npm package.
2. Map columns → `properties`; normalise enums (segment, furnishing, status); coerce
   numerics (rent, area).
3. Generate `slug` (kebab of title + display_id) and `display_id`; validate uniqueness.
4. Emit `seed.sql` (`INSERT` for `properties` + `neighbourhoods` + the `property_media`
   rows from §5).
5. Apply with `wrangler d1 migrations apply rentoo-listings --remote` (schema) then
   `wrangler d1 execute rentoo-listings --remote --file=seed.sql` (data).
6. **Idempotent:** `INSERT … ON CONFLICT(slug) DO UPDATE` (or skip) so re-runs don't
   duplicate.

Separation of concerns: photos → R2 over the S3 SDK; structured data → D1 over generated
SQL + wrangler. No direct D1 write API needed from the scripts.

## 7. Routes

| Route | Render | Source |
|---|---|---|
| `/` | prerender | static + a few featured listings fetched at build |
| `/rent` | SSR | D1, filtered + paginated |
| `/rent/[slug]` | SSR | D1 (property + media + neighbourhood) |
| `/commercial` | SSR | D1 (`segment='commercial'`) |
| `/commercial/[slug]` | SSR | D1 |
| `/neighbourhoods/[slug]` | SSR | D1 (neighbourhood + its listings) |
| `/about`, `/contact`, `/privacy` | prerender | static |
| `/media/[...key]` | endpoint | R2 |
| `404` | prerender | static |

(`/` may server-render if we want always-fresh featured listings; default is prerender
with a rebuild picking up new featured items. Confirm during planning.)

## 8. UI rebuild — design preserved on the new stack

**Tailwind v4** via `@tailwindcss/vite` (not the deprecated `@astrojs/tailwind`), themed
with `@theme` (no `tailwind.config.js`) from the existing `:root` tokens:

```css
@theme {
  --color-background:#FAF7EE; --color-foreground:#0F172A;
  --color-surface-alt:#F2EDE0; --color-surface-card:#FFFFFF;
  --color-primary:#082746;    --color-primary-foreground:#FAF7EE;  /* jaipur navy */
  --color-midnight:#133A60;
  --color-secondary:#16A34A;  --color-secondary-foreground:#FFFFFF; /* ok-green */
  --color-accent:#B5532E;     --color-accent-foreground:#FFFFFF;    /* terracotta signature */
  --color-whatsapp:#25D366;
  --color-muted:#475569; --color-muted-foreground:#94A3B8;
  --color-border:#E5E0D5; --color-input:#F1F5F9; --color-ring:#082746;
  --font-display:"Space Grotesk", system-ui, sans-serif;
  --font-sans:-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  --font-mono:ui-monospace, "SF Mono", Menlo, monospace;
  --radius:10px;               /* shadcn default is 8px; bump to match cards */
  /* 4pt spacing scale, 3 elevation shadows, ease-out cubic-bezier(.22,.61,.36,1) 200ms */
}
```

**Islands policy (keep it lean):**
- **shadcn** (React, `client:visible`) only for: the listing **FilterBar / filter dialog**,
  **selects**, the **mobile menu** toggle, and the **contact / WhatsApp dialog**.
- **Gallery** on listing detail: lightweight **Swiper or vanilla JS**, not React.
- **Magic UI**: at most one or two restrained accents (e.g. a subtle featured-listings
  reveal), `client:load`. Skip confetti/meteors/morphing-text — they fight the clean
  aesthetic the team built. Magic UI is copy-paste source (needs `framer-motion`), not an
  npm dependency.

**Components** (port of the existing inventory): `PropertyCard` (image, display-id tag,
status/verified pills, price row, title, landmark, meta), `SiteHeader` + mobile nav,
`SiteFooter`, `Hero` + search, `FilterBar`, `SectionMarker` (mono uppercase), and the
listing-detail `Gallery`, `SpecRows`, CTA card, location card. Commercial variant adds
price-per-sqft; about adds stats/facts; privacy adds numbered sections.

## 9. Repo structure

```
/                       # Astro app at repo root (replaces static HTML as pages are ported)
  astro.config.mjs
  wrangler.jsonc        # pages_build_output_dir, DB + MEDIA bindings, nodejs_compat
  package.json
  migrations/0001_init.sql
  scripts/
    import-excel.js
    seed-photos.js
  assets/watermark.png  # from Rentooicon.png
  data/listings/<slug>/ # local photo input (git-ignored)
  src/
    pages/  (index, rent/, commercial/, neighbourhoods/, about, contact, privacy, media/, 404)
    components/  (PropertyCard.astro, FilterBar.tsx, Gallery, …)
    layouts/  (BaseLayout.astro)
    lib/db.ts            # typed D1 query helpers
    styles/globals.css   # Tailwind v4 @theme tokens
```

Old static HTML is deleted page-by-page as each is ported (history preserved in git).
The GitHub Pages `/rentoo/` base path is dropped (Pages serves at root).

## 10. Deployment

- Cloudflare **Pages** project `rentoo`, **git integration** to `risjainucd/rentoo`,
  production branch `main`, build `npm run build`, output `dist`.
- Bindings in the Pages project **and** `wrangler.jsonc`: `DB` (D1 `rentoo-listings`,
  with `preview_database_id` for local), `MEDIA` (R2 `rentoo-photos`),
  `compatibility_flags: ["nodejs_compat"]`.
- R2 S3 credentials (Access Key ID / Secret) live in `.env.local` (git-ignored) for the
  seed scripts only — never account credentials.
- First deploy target: `rentoo.pages.dev`.

## 11. Implementation notes / gotchas (carry into the plan)

- `platformProxy.enabled: true` in `astro.config.mjs` — without it, `DB`/`MEDIA` are
  `undefined` under `astro dev` (they still work in prod, so it's easy to miss).
- `wrangler.jsonc` must use `pages_build_output_dir` (Workers' `main` field will fail on
  Pages); `preview_database_id` is required for local `wrangler pages dev`.
- Binding names (`DB`, `MEDIA`) must match exactly between config and code — typos fail
  silently as `undefined`.
- Astro v6 dropped `output: 'hybrid'`; use `output: 'server'` + per-route
  `export const prerender = true`. Every route needs a page/endpoint or it 404s at runtime.
- SheetJS from the CDN tarball, not npm (the npm build is years stale with CVEs).
- `sharp`: load the watermark buffer once at script start, reuse across images.
- D1/SQLite foreign keys are advisory unless `PRAGMA foreign_keys=ON`; enforce app-side
  and use `PRAGMA defer_foreign_keys` if seed insert order trips constraints.
- All `<img>`/`<Image>` carry explicit `width`/`height` to prevent CLS.
- `/media` endpoint sets long-lived immutable cache headers and a Referer check.

## 12. Inputs needed from you before/early in implementation

1. The **Excel file** (or its column headers + a sample row) so the importer maps fields
   and enum values correctly.
2. The **photo folders** (`data/listings/<slug>/…`), or a sample, to validate the
   folder→cover→order convention.
3. Confirm the **watermark** treatment (Rentooicon, bottom-right, low opacity — adjustable).
4. The **Cloudflare account** access / API token for creating the D1 DB, R2 bucket, and
   Pages project (or you run those `wrangler`/dashboard steps with our guidance).

## 13. Sequencing — future sub-projects

1. **← This milestone:** dynamic public site + real photos on `rentoo.pages.dev`.
2. **Admin panel + auth** — owner records, listing CRUD, photo upload UI (shadcn shines
   here), `owners`/`audit_log` tables.
3. **Inquiries + WhatsApp** — rate-limited inquiry writes, WhatsApp deep-links.
4. **Analytics** — GA4.
5. **Custom domain + hardened image CDN** — R2 custom domain, WAF Hotlink Protection,
   `/cdn-cgi/image` transforms, DNS.
6. **Bulk-import automation** — turn the one-off scripts into a repeatable ingest.

## 14. Testing & acceptance

- Local: `astro dev` with platformProxy renders listing pages from a local D1 copy and
  photos from a local R2; filters work; no console errors.
- Import/seed scripts run idempotently (second run is a no-op / clean update).
- Preview deploy on a Pages branch URL before promoting to production.
- Visual parity pass against the current design (the project's own `design-review`
  tooling) on home, `/rent`, listing detail, neighbourhood, commercial.
- Lighthouse: performance and accessibility hold up; static pages ship no unexpected JS.
