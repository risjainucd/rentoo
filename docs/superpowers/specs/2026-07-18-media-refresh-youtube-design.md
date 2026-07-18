# Media refresh + YouTube video hosting — design

**Date:** 2026-07-18
**Branch:** milestone-1-dynamic
**Status:** Draft for review

## 1. Summary

Refresh the site's photos and videos from the client's newly reorganised media
drop, and **move all video hosting from Cloudflare R2 to YouTube** (Unlisted
embeds). The client delivered a `RENTOO/` folder (1.8 GB, downloaded locally)
containing three sections of listing media plus three loose "Excel" files that
are actually freeform Instagram-caption text.

Because the media is local, this needs **no Google Drive API access** — the only
external auth is **YouTube upload** (OAuth). The work splits into an unblocked
Phase 1 (the YouTube switch + refresh of the 93 already-live listings) and a
data-dependent Phase 2 (new + premium listings, whose structured data must be
recovered from sparse captions).

## 2. Current state (what exists today)

- **Videos:** one watermarked MP4 "tour" per listing in R2 (`properties/<slug>/tour`),
  served via `src/pages/media/[...key].ts` with HTTP Range/206 support, rendered
  as a native `<video>` in `src/components/Gallery.astro`. Offline pipeline:
  `scripts/video-upload.mjs`. Seed: `seed/video-media.sql` (never applied to prod —
  was blocked on R2 creds).
- **Photos:** watermarked WebP renditions in R2 (`properties/<slug>/<idx>-<size>.webp`),
  pipeline `scripts/watermark-upload.mjs`, seed `seed/media.sql`. Admin photo
  manager (`src/pages/api/admin/photos/**`) can also upload/reorder/delete.
- **Data model:** `property_media(kind IN ('photo','video'), r2_key, display_order,
  is_cover, width, height, watermarked)`. One video per listing.
- **Listings:** 149 properties seeded; 93 residential listings have photo galleries
  (`seed/photos.json` maps `display_id` → `slug`, `#01`…`#94`).
- **Detail wiring:** `src/pages/rent/[slug].astro` (inline) and
  `src/components/SpaceDetail.astro` (shared by commercial + industrial) build a
  `tourVideo` from the first `kind='video'` row and pass it to `Gallery`.

## 3. The media drop (`RENTOO/`, local, gitignored)

| Section (folder) | Listing folders | Naming | Photos | Videos | Maps to segment |
|---|---|---|---|---|---|
| `inventory 2026/` | 136 (`#01`–`#137`, `#92` absent) | `#NN` | 977 | 81 | residential |
| `Rento Preminium/` | 14 (`##1`–`##14`) | `##N` | 165 | 6 | residential (per decision) |
| `Commercial/` | 17 (`C-1`–`C-19`, `C-12,13` merged, `C-4` absent) | `C-N` | 176 | 2 | commercial |

Loose spreadsheets (freeform caption text, **not** structured tables):

- `inventory 2024.xlsx` — residential captions for **9** ids only (`#1,#3,#4,#05–#10`).
- `rento preminium above 50k.xlsx` — premium captions for **4** (`##2,##3,##4,##6`);
  the header row is itself data (no real column headers).
- `Commercial excel.xlsx` — commercial captions for **23** (`C-1`–`C-23`); covers all folders.

There are **no caption files inside the listing folders** — the sparse Excels are
the only text metadata.

### Coverage split

| Bucket | Count | Media | Metadata | Phase |
|---|---|---|---|---|
| Existing residential `#01`–`#94` | 93 | ✅ | ✅ already in DB | **1** — refresh only |
| Existing commercial (subset of `C-*`) | — | ✅ | ✅ in DB + captions | 1/2 |
| New residential `#95`–`#137` | 43 | ✅ | ❌ (no caption) → drafts | **2** |
| Premium `##1`–`##14` (→ residential) | 14 | ✅ | ⚠️ 4/14 captions | **2** |
| New commercial `C-*` | remainder | ✅ | ✅ captions | **2** |

## 4. Decisions (locked during brainstorming)

1. **Video host:** YouTube, videos **Unlisted**. Retire R2 video hosting.
2. **Upload method:** API-automated script + OAuth. (Quota is a non-issue — Google
   cut `videos.insert` from ~1600 to ~100 units on 2026-12-04, so all ~89 clips
   fit one free day. Residual risk: unaudited-project uploads *can* be "locked as
   private" — mitigate with clean metadata + Unlisted; non-appealable, remedy is
   re-upload via app or pass audit.)
3. **Video processing:** upload **raw** clips (no watermark bake-in). Photos keep
   the existing watermark pipeline.
4. **Source:** local `RENTOO/` folder → **no Drive API needed**; only YouTube OAuth.
5. **New-listing metadata:** extract from captions where present (regex/LLM);
   import media-only listings as **unpublished drafts** to complete later.
6. **Premium tier:** fold `##N` folders into the **residential** segment — no new
   site section.
7. **One tour video per listing** (matches the single-video Gallery). Multi-clip
   folders pick the first (with an override map, as today).
8. **Listings in DB but absent from the drop:** left as-is and reported, never
   auto-unpublished.

## 5. Data model

New migration `migrations/0005_youtube.sql`:

```sql
ALTER TABLE property_media ADD COLUMN youtube_id TEXT;  -- 11-char watch id for kind='video'
```

Video rows keep `kind='video'`, `watermarked=0`. The YouTube id goes in
`youtube_id`; `r2_key` holds the same id as a harmless non-null sentinel (the
column is `NOT NULL`). Photo rows are unchanged. All existing plumbing (admin
video counts, ordering, kind-scoped deletes) keeps working.

`src/lib/types.ts`: add `youtube_id: string | null` to `PropertyMedia`.

## 6. Auth setup (one-time, user-performed)

Single Google Cloud project → OAuth client (Desktop) → scope **`youtube.upload`**
only. First run opens a consent URL; refresh token cached in a git-ignored
`scripts/.youtube-token.json`. Videos must be uploaded to the client's own
channel (service accounts can't own a channel). Exact click-path documented in
the plan.

## 7. Phase 1 — YouTube switch + refresh the 93 existing listings (unblocked)

### 7.1 Photo refresh
Adapt `scripts/watermark-upload.mjs`:
- Source roots become `RENTOO/inventory 2026` (+ `RENTOO/Commercial`) instead of
  repo-root `inventory 2026`.
- Restrict this phase to folders whose `display_id` already resolves via
  `seed/photos.json` (the 93 live listings) so no new-listing logic is needed yet.
- Unchanged: watermark → card/gallery/full WebP → R2 → idempotent `seed/media.sql`
  (`DELETE kind='photo'` + re-`INSERT` per slug).
- ⚠️ Re-import overwrites admin-manager photo edits for those slugs (drop is the
  source of truth — intended).

### 7.2 Video → YouTube
New `scripts/youtube-upload.mjs`:
- Reuse the folder→slug work-list logic from `video-upload.mjs` (pick one clip per
  folder; keep `CLIP_OVERRIDE`).
- For each existing listing's clip: upload raw file to YouTube (`snippet.title` =
  listing display id + type, honest `description`, `status.privacyStatus='unlisted'`,
  `selfDeclaredMadeForKids=false`).
- Maintain a git-ignored ledger `seed/youtube-map.json` (`slug → { youtubeId, file,
  bytes }`) so re-runs **skip already-uploaded clips** (idempotent, avoids dupes).
- Emit `seed/video-media.sql`: `DELETE kind='video'` per slug + `INSERT` with
  `youtube_id` set (`r2_key`=id sentinel, `watermarked=0`).

### 7.3 Frontend
- `src/lib/media.ts`: drop `videoUrl()`; add `youtubeEmbedUrl(id)` →
  `https://www.youtube-nocookie.com/embed/<id>?rel=0&playsinline=1&autoplay=1` and
  `youtubeThumb(id)` → `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
- `src/components/Gallery.astro`: replace the native `<video>` slide with a
  **click-to-load facade** — render the YouTube thumbnail + existing play badge;
  on activate, inject the `nocookie` `<iframe>`; on leaving the slide, remove the
  iframe to stop audio. Keeps current gallery UX; no YouTube JS until clicked.
  Video-prop shape becomes `{ youtubeId, poster, alt }`.
- `src/pages/rent/[slug].astro` + `src/components/SpaceDetail.astro`: build the
  video prop from `v.youtube_id` instead of `videoUrl(v.r2_key)`; poster =
  `youtubeThumb(v.youtube_id)`.

### 7.4 Retire R2 video infra
- `src/pages/media/[...key].ts`: remove the `.mp4` content-type branch and the
  Range/HEAD handling (Range existed **only** for video) → photo-only endpoint.
- Update/trim `test/media.test.ts` + `test/range.test.ts` accordingly.
- Delete `scripts/video-upload.mjs`; keep `scripts/_watermark.mjs` (photos use it).
- Old R2 `.mp4` objects: leave to age out (or delete later, non-blocking).

### 7.5 Apply + deploy
`wrangler d1 execute rentoo-listings --remote --file=…` for the migration +
`media.sql` + `video-media.sql`, then `wrangler pages deploy`.
⚠️ **Blocked on Cloudflare auth** (milestone-2 note) — prepped but may need the
user to run/authorise.

## 8. Phase 2 — New + premium listings (data-dependent)

### 8.1 Caption parser
New `scripts/parse-captions.mjs`: read the three workbooks **as arrays-of-arrays**
(the header row is data), and for each `{id, caption}` extract structured fields:
`rent_inr` (₹/lakh/k), `bhk_type`, `property_type`, location/`landmark`,
`furnishing`, `status`. Emoji-labelled lines (`🏠 Property:`, `📍 Location:`,
`💰 Rent:`, `🛋️ Status:`) make this tractable with regex; an optional LLM pass can
fill ambiguous cases. Output a reviewable `seed/parsed-listings.json`.

### 8.2 Folder → listing mapping
New `scripts/lib/listing-map.mjs`: map the three naming schemes to `{segment, slug,
display_id, published}`:
- `#NN` → residential; `##N` → residential (premium); `C-N` → commercial.
- Existing ids reuse their current slug (via `photos.json`); new ids get a slug
  from parsed data, or a placeholder (`listing-<id>`) for media-only drafts.
- Media-only listings → `published=0` (unpublished draft).

### 8.3 Import + media
- Extend the property importer to upsert new/premium/commercial rows (parsed data
  or draft), regenerating `photos.json` for the full set.
- Run §7.1 photo refresh + §7.2 YouTube upload across the **new** folders too.

### 8.4 Review + publish
Drafts (`published=0`) surface in admin for the client to complete rent/BHK/etc.,
then publish. Parsed listings get a human review pass before publish.

## 9. Non-goals

- No new "Premium" site segment (folded into residential).
- No Drive API / streaming ingestion (media is local).
- No migration of old R2 `.mp4` objects (they were never in prod).
- No auto-unpublishing of listings missing from the drop.

## 10. Risks / open items

- **YouTube private-lock** for unaudited projects (§4.2) — mitigated, not eliminated.
- **Caption parse accuracy** — needs human review before publish; media-only
  residential (`#95`–`#137`) have no caption at all → drafts with placeholder slugs.
- **Cloudflare deploy auth** — Phase 1 §7.5 may block on the user.
- **`RENTOO/` size** — gitignored; never commit.
- **Slug stability** — existing listings must keep current slugs (SEO / likes/views
  keyed by slug); the map reuses `photos.json` slugs for `#01`–`#94`.

## 11. Test plan

- Unit: caption parser (rent/bhk/furnishing extraction), listing-map (3 schemes),
  `media.ts` youtube helpers, trimmed media endpoint.
- Manual/preview: Gallery YouTube facade (load-on-click, teardown-on-leave,
  keyboard), detail pages for a video listing, a photo-only listing, and a draft.
- Pipeline dry-run: `--sample` on both scripts before the full run.
