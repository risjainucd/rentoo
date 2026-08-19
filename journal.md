# Rentoo — Milestone 2 Journal

Date: 2026-07-08 · Branch: `milestone-1-dynamic` · Live: **https://rentoo.in**
(fallback: https://rentoo.rentojaipur.workers.dev)

A batch of client-requested changes (forwarded from Satvik/Rishabh), built, deployed,
and verified live. Stack: Astro SSR + Cloudflare Workers + D1 + R2.

---

## 1. Copy / brand pass — `aa04583`
- **Phone** `8741800496` → **`8740000854`** everywhere (24 refs) + `src/lib/site.ts` constant.
- **"small Jaipur brokerage"** → **"A Jaipur brokerage firm"** (home + about).
- Added scarcity tagline **"Our flats rent out fast — hope you're lucky to get one."** to the hero.
- **Persona: Rishabh → Satvik / "Satvik + the Rentoo team"** across home, about, contact, privacy.
- **Status colours**: "Rented out" in **red**, "Available" in **green** (both detail pages).
  Fixed commercial page's "Let out" → "Rented out". Added `--danger-red` token.
- **Detail headings** shortened (drop "near <landmark>", shown separately) + bolded.
- **BHK filter hidden** on commercial + industrial; `/rent` scoped to residential only.

## 2. Industrial split — `c7386c4`
- New segment **`industrial`** split out of commercial. Taxonomy:
  - Commercial = office / retail / mall shops / BTS land
  - Industrial = warehouse / factory / industrial land
- `migrations/0002` widens the `segment` CHECK (SQLite table rebuild) + re-tags the 8
  warehouse/factory listings → industrial. **11 commercial / 8 industrial / 130 residential.**
- New `/industrial` index + `/industrial/[slug]` routes.
- Extracted shared **`SpaceDetail.astro`** (commercial + industrial detail share one source
  of truth); `commercial/[slug]` became a thin wrapper.
- Nav "Industrial" → `/industrial`; `PropertyCard` links industrial cards to `/industrial`.

## 3. Neighbourhood major areas — `f864432` + `d578e7c`
- **Problem**: 88 flat "neighbourhood" tags, mostly landmark/building names (BMW Showroom,
  Sky Pearl Apartment, Kedia The Kunba…), most with a single listing → "too many suggestions".
- **Research** (`docs/jaipur-area-hierarchy.md`): portals (99acres/MagicBricks/NoBroker) use a
  flat locality list + curated "popular" set, not a strict tree. Produced 16 major areas.
- `migrations/0003` adds `major_slug` / `major_area` to `neighbourhoods`;
  `seed/neighbourhood-areas.sql` maps every tag to a major area (all 26 building-name tags
  web-researched + placed, e.g. Sky Pearl/Subhashish Geeta/JC Heights → Mansarovar,
  The Index/Golden Domes → Jagatpura, Vedang Heights → Sodala, Haldighati/Terminal 1 → Pratap Nagar).
- `db.listMajorAreas(segment?)`; new `?area=` filter (`neighbourhood_slug IN (major_slug subquery)`),
  keeping `?neighbourhood=` for deep-link back-compat.
- **Dropdown: 88 tags → 16 major areas.** "Browse by area" on home + all index pages.

## 4. Favourites + filters — `de89306`
- `migrations/0004` adds `views` / `likes` / `featured` columns + indexes.
- API: **`POST /api/like/[slug]`** (toggle, clamps ≥0), **`POST /api/view/[slug]`** (increment).
- **❤️ heart** on residential cards — device-local favourites (`localStorage rentoo:favs`) +
  aggregate like counter, optimistic UI.
- Detail pages fire a **view beacon** once per session (`sessionStorage`).
- FilterBar **"Show me" sort**: Newest / Featured / Most viewed / Budget-friendly / Most liked
  (`?sort=`, `orderByFor()` drives ORDER BY).

## 5. Video tours (49) uploaded to R2
- `scripts/video-upload.mjs` transcodes + watermarks + posters → R2 bucket `rentoo-photos`,
  emits `seed/video-media.sql` (49 rows). Runs offline (ffmpeg + sharp).
- Added **retry-with-backoff** to the R2 `upload()` (`e7db584`) — R2 intermittently 500s under
  concurrency; first run dropped ~6/49, clean 49/49 after retry.
- Verified inline video streaming on live: **HTTP 206** with `content-range` (iOS-safe).

## 6. Photos fix + hide rented — `b1d050e`
- **Photos weren't showing** because `seed/media.sql` (705 photo rows, 64 listings) had **never
  been applied to remote D1** — only video rows were. Applied it → galleries render.
  ⚠️ `media.sql` does a BROAD per-listing delete, so it must run **before** `video-media.sql`
  (whose delete is `kind='video'`-scoped). Re-applied video rows after to restore the 49.
- **Rented listings hidden site-wide** at the query level (`buildListingsQuery`, `listMajorAreas`,
  `getListingBySlug` all exclude `status='rented'`; rented detail pages 404). Reversible via
  status flip. 70 residential were rented → live residential **130 → 60**.

## 7. Logo + covers + maps
- **Logo** enlarged (28→40px mobile, 32→46px desktop) + switched to `/Rentoo.svg`.
- **Weak cover photos** (toilet/blank-wall leads) re-picked from each listing's own photos via
  `setCover` (verified by viewing all 23 visible covers — none were rotated; "seedhi nahi" was
  cover-quality, not orientation).
- **Maps**: every listing now shows a real map. `mapEmbed()` in `src/lib/utils.ts` uses the
  listing's `map_url` if set (exact pin), else a **keyless OpenStreetMap embed** centred on the
  major area (Google's keyless embed is now frame-blocked; OSM allows framing). "Wire in an exact
  location later" = just set `map_url` (a Google "Embed a map" src).

## 8. Admin portal (Phase 1) — `fcf89c3` + `75f076b`
- **`/admin`** listings table + **`/admin/[slug]`** editor: rent, status, type, BHK, furnishing,
  landmark, description, **map_url**, **featured**, published, and **cover picker**.
  Writes via same-origin form POST → `updateListingFields` / `setCover`.
- **Auth: Cloudflare Access** (One-Time-PIN). `src/middleware.ts` guards `/admin*` + `/api/admin*`
  and verifies the Access RS256 JWT (`src/lib/admin-auth.ts`) against team JWKS + AUD, plus an
  `ADMIN_EMAILS` allowlist. **Fails closed** — 403 until configured.
- Config: `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` as Worker vars (public identifiers, in wrangler.jsonc);
  `ADMIN_EMAILS` as a Worker **secret** (not in git) = `rentojaipur@gmail.com,rishabhucd@gmail.com`.
- Access app "Rentoo Admin" (team `rentoo.cloudflareaccess.com`, AUD `9fa29aca…d04c`) protects
  `rentoo.in/admin` + `/api/admin`.

## 9. Domain move → rentoo.in
- `rentoo.in` custom domain added **via the Cloudflare dashboard** (my CLI token is `zone:read`,
  can't edit DNS; a `wrangler routes` attempt failed on the existing-record conflict and briefly
  disabled workers.dev — reverted). Kept **out of `wrangler.jsonc` routes** to avoid conflicts.
- All content is domain-agnostic (relative URLs; media referer check uses dynamic `siteOrigin`),
  so no code changes were needed for the move.

---

## Gotchas / lessons
- **Remote D1 has no `d1_migrations` table** (0001 was applied via direct `execute`), so
  `wrangler d1 migrations apply --remote` fails ("table already exists"). Apply new migrations
  with `wrangler d1 execute --remote --file migrations/000N.sql`.
- **`seed/` is gitignored** — seed data lives locally, applied via `wrangler d1 execute`.
- **`media.sql` before `video-media.sql`** (broad vs scoped delete).
- **`astro dev` DOES run the middleware for `/admin`** (as of Astro 6 — an older note here said
  it did not). It fails closed with **403** without a Cloudflare Access JWT, so the admin POST
  handlers cannot be exercised under `astro dev` at all. Test admin *islands* by rendering them
  from a scratch page outside `/admin`, and verify auth on the real worker
  (`wrangler dev -c dist/server/wrangler.json`) or live.
- **Deploy**: `npm run build && npx wrangler deploy` (adapter emits `dist/server/wrangler.json`).
  Adding `routes` to config auto-disables `workers.dev`; with no routes it stays enabled.
- **Admin login debugging** (the long tail): the real blocker was never code — it was
  (a) subdomain confusion (`admin.rentoo.in` vs `rentoo.in/admin`), then (b) the login email
  `rishabhucd@gmail.com` not being in `ADMIN_EMAILS`. Diagnosed with `wrangler tail`.

## Live state (2026-07-08)
- **rentoo.in** serving everything: industrial split, 16 major areas, favourites + sorts, 49 tour
  videos, photos, rented hidden, bigger logo, better covers, area maps, admin portal (working).
- **Open**: `www.rentoo.in` misconfigured (CNAME → cloudflareaccess.com, NXDOMAIN-ish) — remove or
  redirect to apex. Phase 2 admin (in-portal photo upload w/ watermark) not built.
