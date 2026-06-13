# Rentoo Milestone 1 — Dynamic Public Site + Real Photos on Cloudflare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current static Rentoo prototype as an Astro app on Cloudflare Pages that serves listings from D1 and real watermarked photos from R2, live at `rentoo.pages.dev`.

**Architecture:** Astro 6 with `output: 'server'` on the `@astrojs/cloudflare` adapter (git-integrated Pages). Marketing pages prerender; listing pages server-render from D1; photos are pre-watermarked + pre-sized into R2 by one-off Node scripts and streamed through an Astro `/media` endpoint. The existing design is preserved by porting markup into Astro components themed with Tailwind v4 tokens copied from the current `styles.css`. React (shadcn/Magic UI) appears only as small islands for genuinely interactive pieces (filters, mobile menu, gallery).

**Tech Stack:** Astro 6, `@astrojs/cloudflare`, Cloudflare Pages/D1/R2, Wrangler, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui + Magic UI (React 19 islands), `sharp`, SheetJS (CDN build), `@aws-sdk/client-s3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-rentoo-milestone-1-dynamic-cloudflare-design.md`

---

## Testing philosophy for this plan

Strict red-green TDD applies to **pure logic** — query builders, slug/enum normalisation, r2-key naming, cover/order detection, the `/media` referer check. These are extracted into pure functions so they are unit-testable with Vitest without a live database or network.

Integration glue (the Astro pages, the import/seed scripts wiring those pure functions to real D1/R2, the deploy) is verified by **build-and-run**: `astro dev` / `wrangler pages dev`, a preview deploy, and a visual-parity check against the current site. Each such task states the exact command and the exact expected observation.

Where an external API shape is version-sensitive (the adapter's binding accessor, shadcn's Astro init flags, Tailwind v4 `@theme`), the task says **verify against current docs via context7 first**, with the expected default. Do not hard-code an API the running version rejects.

---

## File structure (created/modified in this plan)

```
package.json                     # Astro app manifest + scripts + deps          (Task 0.1)
.gitignore                       # add node_modules, dist, .env.local, data/listings, .wrangler  (Task 0.1)
astro.config.mjs                 # cloudflare adapter, server output, vite/tailwind, react  (Tasks 0.2-0.4)
wrangler.jsonc                   # Pages output dir, DB + MEDIA bindings, nodejs_compat  (Task 0.5)
tsconfig.json                    # @/* path alias for shadcn                      (Task 0.4)
components.json                  # shadcn config                                  (Task 0.4)
vitest.config.ts                 # test runner                                    (Task 0.6)
migrations/0001_init.sql         # D1 schema                                      (Task 1.1)
migrations/0002_media_unique.sql # UNIQUE(r2_key) for idempotent media seeding    (Task 2.5)
src/
  env.d.ts                       # typed Astro.locals.runtime.env (DB, MEDIA)     (Task 0.5)
  styles/globals.css             # Tailwind v4 @theme = existing design tokens    (Task 0.3)
  lib/
    types.ts                     # Property, PropertyMedia, Neighbourhood, ListingCard, ListingFilters  (Task 1.2)
    sql.ts                       # PURE: buildListingsQuery, mapRowToCard, parseListingFilters  (Task 1.3)
    db.ts                        # thin D1 executors using sql.ts + getDb(locals) (Task 1.4)
    media.ts                     # PURE: mediaUrl(key,size), isAllowedReferer      (Tasks 1.2,3.1)
  middleware.ts                  # attach db + site origin to locals               (Task 1.4)
  layouts/BaseLayout.astro       # head, fonts, header, footer, skip-link          (Task 4.1)
  components/
    SiteHeader.astro             # nav shell                                       (Task 4.2)
    MobileNav.tsx                # shadcn Sheet island (client:visible)            (Task 4.2)
    SiteFooter.astro             # footer                                          (Task 4.3)
    SectionMarker.astro          # mono uppercase marker                           (Task 4.4)
    Pill.astro                   # status / verified / display-id pills            (Task 4.4)
    PropertyCard.astro           # the repeated listing card                       (Task 4.5)
    FilterBar.tsx                # shadcn filter island (client:visible)           (Task 5.2)
    Gallery.astro                # detail photo gallery, VANILLA JS (spec §8)      (Task 5.3)
    ContactDialog.tsx            # shadcn contact/WhatsApp dialog island           (Task 5.8)
  pages/
    index.astro                  # home (SSR — featured from D1)                   (Task 5.1)
    rent/index.astro             # listing index (SSR + filters)                   (Task 5.4)
    rent/[slug].astro            # listing detail (SSR)                            (Task 5.5)
    commercial/index.astro       # commercial index (SSR)                          (Task 5.6)
    commercial/[slug].astro      # commercial detail (SSR)                         (Task 5.6)
    neighbourhoods/[slug].astro  # neighbourhood (SSR)                             (Task 5.7)
    about.astro contact.astro privacy.astro  # marketing (prerender)              (Task 5.8)
    404.astro                    # not found (prerender)                           (Task 5.9)
    media/[...key].ts            # R2 image endpoint                               (Task 3.1)
scripts/
  lib/transform.ts               # PURE: slugify, makeDisplayId, normalizeEnums, rowToProperty, coverAndOrder, r2KeyFor  (Tasks 2.1,2.2,2.4)
  import-excel.mjs               # xlsx -> seed.sql (properties + neighbourhoods)  (Task 2.3)
  seed-photos.mjs                # folders -> watermark/resize -> R2 -> media SQL  (Task 2.5)
assets/watermark.png             # derived from Rentooicon.png                     (Task 2.4)
test/                            # *.test.ts for the PURE modules above
```

**Frozen contracts (every later task must match these names/signatures exactly):**

```ts
// src/lib/types.ts
export type Segment = 'residential' | 'commercial';
export type Furnishing = 'furnished' | 'semi-furnished' | 'unfurnished';
export type Status = 'available' | 'rented' | 'on-hold';
export type MediaSize = 'card' | 'gallery' | 'full';

export interface Property {
  id: string; display_id: string; segment: Segment; bhk_type: string | null;
  property_type: string; rent_inr: number; area_sqft: number | null;
  furnishing: Furnishing | null; status: Status; landmark: string | null;
  neighbourhood_slug: string; map_url: string | null; description: string | null;
  slug: string; published: 0 | 1; created_at: string;
}
export interface PropertyMedia {
  id: string; property_id: string; kind: 'photo' | 'video'; r2_key: string;
  display_order: number; is_cover: 0 | 1; width: number | null; height: number | null; watermarked: 0 | 1;
}
export interface Neighbourhood {
  slug: string; name: string; display_order: number; cover_r2_key: string | null; short_description: string | null;
}
export interface ListingCard {
  slug: string; display_id: string; title: string; rent_inr: number; landmark: string | null;
  segment: Segment; bhk_type: string | null; furnishing: Furnishing | null; status: Status;
  neighbourhood_slug: string; cover_key: string | null; cover_w: number | null; cover_h: number | null;
}
export interface ListingFilters {
  segment?: Segment; neighbourhood?: string; bhk?: string;
  furnishing?: Furnishing; minRent?: number; maxRent?: number;
  page?: number; perPage?: number; // perPage default 12
}
```

```ts
// src/lib/db.ts  (executor signatures — implementations in Task 1.4)
export function getDb(locals: App.Locals): D1Database;
export function listListings(db: D1Database, f: ListingFilters): Promise<{ items: ListingCard[]; total: number }>;
export function getListingBySlug(db: D1Database, slug: string): Promise<{ property: Property; media: PropertyMedia[]; neighbourhood: Neighbourhood } | null>;
export function listNeighbourhoods(db: D1Database): Promise<Neighbourhood[]>;
export function getNeighbourhood(db: D1Database, slug: string): Promise<Neighbourhood | null>;
export function featuredListings(db: D1Database, limit: number): Promise<ListingCard[]>;
```

```ts
// src/lib/media.ts
export function mediaUrl(r2KeyBase: string, size: MediaSize): string;     // -> `/media/${r2KeyBase}-${size}.webp`
export function isAllowedReferer(referer: string | null, siteOrigin: string): boolean;
// scripts/lib/transform.ts
export function r2KeyFor(slug: string, index: number, size: MediaSize): string; // -> `properties/${slug}/${index}-${size}.webp`
```

`r2_key` stored in D1 is the **base** (`properties/<slug>/<n>`); the size suffix + `.webp` are appended by `mediaUrl`/`r2KeyFor`. Card grids use `cover_key` (the base) + `mediaUrl(base,'card')`.

---

## Phase 0 — Scaffold, config, and a deployed walking skeleton

### Task 0.1: Initialize the Astro project at repo root

**Files:**
- Create: `package.json`, `src/pages/index.astro` (temporary placeholder), `src/env.d.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Scaffold Astro into the existing repo (non-empty dir).** The current static HTML stays untouched for now; Astro adds `src/`, `package.json`, etc.

Run:
```bash
npm create astro@latest -- --template minimal --no-install --no-git --typescript strict .
```
If it refuses on a non-empty directory, scaffold in a temp dir and move files in:
```bash
npm create astro@latest rentoo-astro -- --template minimal --no-install --no-git --typescript strict
cp -R rentoo-astro/{src,package.json,tsconfig.json,astro.config.mjs} . && rm -rf rentoo-astro
```

- [ ] **Step 2: Install deps.**
```bash
npm install
npm install @astrojs/cloudflare @astrojs/react react react-dom
npm install -D @tailwindcss/vite tailwindcss wrangler vitest sharp @aws-sdk/client-s3 @types/react @types/react-dom
```

- [ ] **Step 3: Append to `.gitignore`:**
```
node_modules/
dist/
.astro/
.wrangler/
.env.local
data/listings/
seed/
```
> `data/listings/` and `seed/` are **local-only, never committed**. `data/listings/` is a **manual input you must supply** before Phase 2 (the source `listings.xlsx` + the per-listing photo folders). The repo does not contain it; create and populate it yourself.

- [ ] **Step 4: Verify dev server boots.**
Run: `npm run dev`
Expected: Astro dev server starts on `http://localhost:4321` with no errors; the placeholder page renders. Stop it (Ctrl-C).

- [ ] **Step 5: Commit.**
```bash
git add -A && git commit -m "chore(astro): scaffold Astro app at repo root"
```

### Task 0.2: Configure the Cloudflare adapter (server output)

**Files:** Modify `astro.config.mjs`

- [ ] **Step 1: Confirm current adapter API via context7** (`resolve-library-id "@astrojs/cloudflare"` → `query-docs` for "platformProxy server output"). Default to the config below.

- [ ] **Step 2: Write `astro.config.mjs`:**
```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
});
```

- [ ] **Step 3: Verify build produces a Cloudflare worker output.**
Run: `npm run build`
Expected: build succeeds and emits `dist/` containing a `_worker.js`/`_routes.json` (Cloudflare output). No adapter errors.

- [ ] **Step 4: Commit.**
```bash
git add astro.config.mjs && git commit -m "feat(astro): cloudflare adapter, server output + platformProxy"
```

### Task 0.3: Tailwind v4 with the existing design tokens

**Files:** Create `src/styles/globals.css`; Modify `astro.config.mjs`

- [ ] **Step 1: Add the Tailwind Vite plugin to `astro.config.mjs`:**
```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  vite: { plugins: [tailwindcss()] },
});
```

- [ ] **Step 2: Create `src/styles/globals.css`** (tokens copied verbatim from the current `styles.css` `:root`):
```css
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap");
@import "tailwindcss";

@theme {
  --color-background:#FAF7EE; --color-foreground:#0F172A;
  --color-surface-alt:#F2EDE0; --color-surface-card:#FFFFFF; --color-haze:#E4ECF5;
  --color-primary:#082746; --color-primary-foreground:#FAF7EE; --color-midnight:#133A60;
  --color-secondary:#16A34A; --color-secondary-foreground:#FFFFFF; --color-ok-mist:#DCFCE7;
  --color-accent:#B5532E; --color-accent-foreground:#FFFFFF; --color-accent-mist:#F5E4DA;
  --color-whatsapp:#25D366; --color-whatsapp-deep:#1FB958; --color-focus:#EA580C;
  --color-muted:#475569; --color-muted-foreground:#94A3B8; --color-rest:#64748B;
  --color-border:#E5E0D5; --color-input:#F1F5F9; --color-ring:#082746;
  --font-display:"Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-sans:-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  --font-mono:ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  --radius:10px; --radius-sm:4px; --radius-md:8px; --radius-lg:12px;
  --shadow-elev1:0 1px 2px rgba(8,39,70,.04),0 1px 3px rgba(8,39,70,.06);
  --shadow-elev2:0 4px 8px rgba(8,39,70,.06),0 2px 4px rgba(8,39,70,.04);
  --shadow-elev3:0 12px 24px rgba(8,39,70,.10);
  --ease-out:cubic-bezier(0.22,0.61,0.36,1);
}
html { background:var(--color-background); color:var(--color-foreground); font-family:var(--font-sans); }
```

- [ ] **Step 3: Import the stylesheet** in the temporary `src/pages/index.astro` (`import '../styles/globals.css';` in the frontmatter) and add a `<h1 class="font-display text-primary">Rentoo</h1>`.

- [ ] **Step 4: Verify the token + font render.**
Run: `npm run dev` → open `/`
Expected: sandstone `#FAF7EE` background, navy heading in Space Grotesk. Stop server.

- [ ] **Step 5: Commit.**
```bash
git add astro.config.mjs src/styles/globals.css src/pages/index.astro && git commit -m "feat(ui): Tailwind v4 with Rentoo design tokens"
```

### Task 0.4: React + shadcn/ui

**Files:** Modify `astro.config.mjs`, `tsconfig.json`; Create `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`

- [ ] **Step 1: Add React integration** to `astro.config.mjs` `integrations: [react()]` (import `react from '@astrojs/react'`).

- [ ] **Step 2: Add the `@/*` path alias** to `tsconfig.json` `compilerOptions`:
```json
"baseUrl": ".",
"paths": { "@/*": ["src/*"] }
```

- [ ] **Step 3: Initialise shadcn (verify flags via context7 `shadcn` docs first; default below).**
Run: `npx shadcn@latest init`
Choose: base color **Neutral**, CSS file `src/styles/globals.css`, CSS variables **yes**. This writes `components.json` + `src/lib/utils.ts`. Then add one component:
Run: `npx shadcn@latest add button`

- [ ] **Step 4: Map shadcn semantic vars to brand tokens.** shadcn writes its own `--primary` etc. into `globals.css`; reconcile so they reference the brand values (navy primary, sandstone bg, terracotta accent/destructive, `--radius:10px`). Keep the `@theme` block from Task 0.3 as the source of truth and set shadcn's `:root` vars to the same hex values.

- [ ] **Step 5: Smoke-test the island.** In `src/pages/index.astro` add `<Button client:visible>OK</Button>` (import from `@/components/ui/button`).
Run: `npm run dev` → `/`
Expected: a navy, 10px-radius button hydrates and is clickable (no hydration errors in console). Stop server. Revert the temporary button after.

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "feat(ui): React + shadcn/ui themed to brand tokens"
```

### Task 0.5: Cloudflare resources + bindings (D1, R2)

**Files:** Create `wrangler.jsonc`; Modify `src/env.d.ts`

> **DEPLOY TARGET = CLOUDFLARE WORKERS** (verified: adapter v13 emits `dist/server/entry.mjs` + `dist/server/wrangler.json`, not a Pages `_worker.js`). Deploy headlessly via `wrangler deploy` → `*.workers.dev`. No dashboard/git-integration needed.

- [ ] **Step 1: Authenticate + create resources** (`wrangler login` is the one interactive step; it persists creds so everything after is headless):
```bash
npx wrangler login
npx wrangler d1 create rentoo-listings        # note the database_id printed
npx wrangler r2 bucket create rentoo-photos
npx wrangler kv namespace create SESSION       # note the id printed — adapter needs a SESSION KV
```

- [ ] **Step 2: Write root `wrangler.jsonc`** (Workers config; the @astrojs/cloudflare adapter merges it into `dist/server/wrangler.json` at build). Paste the real ids:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "rentoo",
  "compatibility_date": "2026-06-13",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "rentoo-listings", "database_id": "<REAL_D1_ID>" }
  ],
  "r2_buckets": [ { "binding": "MEDIA", "bucket_name": "rentoo-photos" } ],
  "kv_namespaces": [ { "binding": "SESSION", "id": "<REAL_KV_ID>" } ]
}
```
(No `pages_build_output_dir` — that's Pages-only. `main`/`assets` are injected by the adapter.)

- [ ] **Step 3: Binding types** — `src/env.d.ts` already declares `interface Env { DB; MEDIA }` + `App.Locals` (done in Task 1.4) and is correct for adapter v13. No change needed; `SESSION`/`IMAGES` are adapter-managed and need no app types.

- [ ] **Step 4: Verify the adapter merges the bindings into the build.**
Run: `npm run build && node -e "const c=require('./dist/server/wrangler.json');console.log('d1:',c.d1_databases.length,'r2:',c.r2_buckets.length,'kv:',c.kv_namespaces.map(k=>k.binding))"`
Expected: `d1: 1 r2: 1 kv: [ 'SESSION' ]`. If empty, the root `wrangler.jsonc` isn't being picked up — check `@astrojs/cloudflare` docs (context7) for the expected config location.

- [ ] **Step 5: Commit.**
```bash
git add wrangler.jsonc && git commit -m "chore(cf): wrangler Workers config — D1 + R2 + SESSION KV bindings"
```

### Task 0.6: Vitest setup

**Files:** Create `vitest.config.ts`, `test/smoke.test.ts`; Modify `package.json`

- [ ] **Step 1: `vitest.config.ts`:**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
```

- [ ] **Step 2: Add script** to `package.json`: `"test": "vitest run"`.

- [ ] **Step 3: `test/smoke.test.ts`:**
```ts
import { expect, test } from 'vitest';
test('vitest runs', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 4: Run.** `npm test` → Expected: 1 passed.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "test: vitest harness"`

### Task 0.7: Walking-skeleton deploy (DE-RISK — do this before building the UI)

Proves Astro SSR reading D1 **and** R2 works end-to-end, deployed live on `*.workers.dev` — before building the UI.

**Files:** Create `migrations/0000_skeleton.sql`, `src/pages/_skeleton.astro` (temporary)

- [ ] **Step 1: Minimal table + row** in `migrations/0000_skeleton.sql`:
```sql
CREATE TABLE IF NOT EXISTS skeleton (id INTEGER PRIMARY KEY, note TEXT);
INSERT INTO skeleton (id, note) VALUES (1, 'd1-alive');
```
Apply local + remote:
```bash
npx wrangler d1 execute rentoo-listings --local  --file=migrations/0000_skeleton.sql
npx wrangler d1 execute rentoo-listings --remote --file=migrations/0000_skeleton.sql
```

- [ ] **Step 2: Put one R2 object.** `printf r2-alive > /tmp/ping.txt && npx wrangler r2 object put rentoo-photos/ping.txt --file=/tmp/ping.txt --remote`

- [ ] **Step 3: `src/pages/_skeleton.astro`** — access bindings via the Workers env import (`Astro.locals.runtime.env` was removed in Astro v6):
```astro
---
export const prerender = false;
import { env } from 'cloudflare:workers';
const e = env as unknown as Env;
const row = await e.DB.prepare('SELECT note FROM skeleton WHERE id=1').first<{ note: string }>();
const obj = await e.MEDIA.get('ping.txt');
const r2 = obj ? await obj.text() : 'MISSING';
---
<p>D1: {row?.note} · R2: {r2}</p>
```

- [ ] **Step 4: Verify locally with real bindings.**
```bash
npm run build && npx wrangler dev
```
Open the printed local URL + `/_skeleton`. Expected: `D1: d1-alive · R2: r2-alive`.

- [ ] **Step 5: Deploy to Workers (headless — no dashboard).** Run `npx wrangler deploy` (it consumes the adapter's generated `dist/server/wrangler.json`; if wrangler can't locate the entry, pass `-c dist/server/wrangler.json`). Confirm the exact invocation against current `@astrojs/cloudflare` deploy docs (context7) — **this de-risk step exists precisely to nail the deploy command.** It prints the live URL `https://rentoo.<your-subdomain>.workers.dev` (enable workers.dev once in the dashboard if prompted).

- [ ] **Step 6: Verify live.** Visit `https://rentoo.<subdomain>.workers.dev/_skeleton`.
Expected: `D1: d1-alive · R2: r2-alive`. **If this fails, stop and fix the deploy path before any further task.**

- [ ] **Step 7: Remove the skeleton.**
```bash
git rm src/pages/_skeleton.astro migrations/0000_skeleton.sql
git commit -m "chore(cf): walking-skeleton deploy verified (D1+R2 SSR on Workers)"
```
(Optionally `DROP TABLE skeleton` on remote D1 — harmless to leave.)

---

## Phase 1 — Data layer (D1)

### Task 1.1: Schema migration

**Files:** Create `migrations/0001_init.sql`

- [ ] **Step 1: Write the DDL** (exactly the spec §4 schema — `neighbourhoods`, `properties`, `property_media` with all indexes). Copy it verbatim from the spec file.

- [ ] **Step 2: Apply local + remote.**
```bash
npx wrangler d1 execute rentoo-listings --local  --file=migrations/0001_init.sql
npx wrangler d1 execute rentoo-listings --remote --file=migrations/0001_init.sql
```

- [ ] **Step 3: Verify tables exist.**
Run: `npx wrangler d1 execute rentoo-listings --local --command "SELECT name FROM sqlite_master WHERE type='table'"`
Expected: lists `neighbourhoods`, `properties`, `property_media`.

- [ ] **Step 4: Commit.** `git add migrations/0001_init.sql && git commit -m "feat(db): D1 schema (properties, media, neighbourhoods)"`

### Task 1.2: Domain types + media URL helper

**Files:** Create `src/lib/types.ts`, `src/lib/media.ts`, `test/media.test.ts`

- [ ] **Step 1: Write `src/lib/types.ts`** — exactly the "Frozen contracts" types block above.

- [ ] **Step 2: Write the failing test** `test/media.test.ts`:
```ts
import { expect, test, describe } from 'vitest';
import { mediaUrl, isAllowedReferer } from '../src/lib/media';

describe('mediaUrl', () => {
  test('appends size + webp to base key', () => {
    expect(mediaUrl('properties/2bhk-gulab-garh-01/0', 'card'))
      .toBe('/media/properties/2bhk-gulab-garh-01/0-card.webp');
  });
});
describe('isAllowedReferer', () => {
  const origin = 'https://rentoo.pages.dev';
  test('allows same-origin', () => expect(isAllowedReferer('https://rentoo.pages.dev/rent', origin)).toBe(true));
  test('allows empty referer (direct nav / browser strip)', () => expect(isAllowedReferer(null, origin)).toBe(true));
  test('blocks foreign origin', () => expect(isAllowedReferer('https://evil.example/x', origin)).toBe(false));
});
```

- [ ] **Step 3: Run → fails** (`mediaUrl is not a function`). `npm test`

- [ ] **Step 4: Implement `src/lib/media.ts`:**
```ts
import type { MediaSize } from './types';
export function mediaUrl(r2KeyBase: string, size: MediaSize): string {
  return `/media/${r2KeyBase}-${size}.webp`;
}
export function isAllowedReferer(referer: string | null, siteOrigin: string): boolean {
  if (!referer) return true;                 // browsers often strip it; don't block real users
  try { return new URL(referer).origin === siteOrigin; } catch { return false; }
}
```

- [ ] **Step 5: Run → passes.** `npm test`

- [ ] **Step 6: Commit.** `git add src/lib/types.ts src/lib/media.ts test/media.test.ts && git commit -m "feat(lib): domain types + media URL/referer helpers"`

### Task 1.3: Pure SQL builders + row mappers (TDD)

**Files:** Create `src/lib/sql.ts`, `test/sql.test.ts`

- [ ] **Step 1: Write failing tests** `test/sql.test.ts`:
```ts
import { expect, test, describe } from 'vitest';
import { buildListingsQuery, mapRowToCard, parseListingFilters } from '../src/lib/sql';

describe('buildListingsQuery', () => {
  test('defaults: published, newest first, page 1 of 12', () => {
    const { sql, params } = buildListingsQuery({});
    expect(sql).toContain('p.published = 1');
    expect(sql).toContain('p.segment');                 // segment selected for routing
    expect(sql).toContain('LEFT JOIN property_media pm');
    expect(sql).toMatch(/ORDER BY p\.created_at DESC/);
    expect(params).toEqual([12, 0]);            // LIMIT, OFFSET
  });
  test('filters compose with bound params in order', () => {
    const { sql, params } = buildListingsQuery({ segment: 'residential', neighbourhood: 'mansarovar', minRent: 10000, maxRent: 40000, page: 2, perPage: 10 });
    expect(sql).toContain('p.segment = ?');
    expect(sql).toContain('p.neighbourhood_slug = ?');
    expect(sql).toContain('p.rent_inr >= ?');
    expect(sql).toContain('p.rent_inr <= ?');
    // segment, neighbourhood, minRent, maxRent, LIMIT(=perPage), OFFSET(=perPage*(page-1))
    expect(params).toEqual(['residential', 'mansarovar', 10000, 40000, 10, 10]);
  });
});
describe('mapRowToCard', () => {
  test('builds a ListingCard incl. title from bhk + property_type and segment', () => {
    const card = mapRowToCard({
      slug: 's', display_id: '#01', segment: 'residential', bhk_type: '2BHK', property_type: 'apartment', rent_inr: 35000,
      landmark: 'near Gulab Garh', furnishing: 'furnished', status: 'available',
      neighbourhood_slug: 'mansarovar', cover_key: 'properties/s/0', cover_w: 1200, cover_h: 900,
    } as any);
    expect(card.title).toBe('2BHK apartment');
    expect(card.segment).toBe('residential');
    expect(card.cover_key).toBe('properties/s/0');
  });
});
describe('parseListingFilters', () => {
  test('coerces query params to typed ListingFilters', () => {
    const f = parseListingFilters(new URL('https://x/rent?segment=residential&neighbourhood=mansarovar&bhk=2BHK&furnishing=furnished&minRent=10000&maxRent=40000&page=2'));
    expect(f).toEqual({ segment: 'residential', neighbourhood: 'mansarovar', bhk: '2BHK', furnishing: 'furnished', minRent: 10000, maxRent: 40000, page: 2 });
  });
  test('omits absent params and ignores junk numbers', () => {
    const f = parseListingFilters(new URL('https://x/rent?minRent=abc'));
    expect(f).toEqual({});
  });
});
```

- [ ] **Step 2: Run → fails.** `npm test`

- [ ] **Step 3: Implement `src/lib/sql.ts`:**
```ts
import type { ListingFilters, ListingCard, Segment, Furnishing } from './types';

const SELECT_CARD = `
  SELECT p.slug, p.display_id, p.segment, p.bhk_type, p.property_type, p.rent_inr, p.landmark,
         p.furnishing, p.status, p.neighbourhood_slug,
         pm.r2_key AS cover_key, pm.width AS cover_w, pm.height AS cover_h
  FROM properties p
  LEFT JOIN property_media pm ON pm.property_id = p.id AND pm.is_cover = 1`;

export function buildListingsQuery(f: ListingFilters): { sql: string; params: unknown[]; countSql: string; countParams: unknown[] } {
  const where: string[] = ['p.published = 1'];
  const params: unknown[] = [];
  if (f.segment)       { where.push('p.segment = ?');            params.push(f.segment); }
  if (f.neighbourhood) { where.push('p.neighbourhood_slug = ?'); params.push(f.neighbourhood); }
  if (f.bhk)           { where.push('p.bhk_type = ?');           params.push(f.bhk); }
  if (f.furnishing)    { where.push('p.furnishing = ?');         params.push(f.furnishing); }
  if (f.minRent != null){ where.push('p.rent_inr >= ?');         params.push(f.minRent); }
  if (f.maxRent != null){ where.push('p.rent_inr <= ?');         params.push(f.maxRent); }
  const whereSql = where.join(' AND ');
  const perPage = f.perPage ?? 12;
  const offset = perPage * ((f.page ?? 1) - 1);
  const sql = `${SELECT_CARD} WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM properties p WHERE ${whereSql}`;
  return { sql, params: [...params, perPage, offset], countSql, countParams: [...params] };
}

export function mapRowToCard(r: Record<string, any>): ListingCard {
  const title = [r.bhk_type, r.property_type].filter(Boolean).join(' ');
  return {
    slug: r.slug, display_id: r.display_id, title, rent_inr: r.rent_inr, landmark: r.landmark,
    segment: r.segment, bhk_type: r.bhk_type, furnishing: r.furnishing, status: r.status,
    neighbourhood_slug: r.neighbourhood_slug, cover_key: r.cover_key, cover_w: r.cover_w, cover_h: r.cover_h,
  };
}

// Pure: parse a request URL's query string into typed ListingFilters (drops absent/invalid).
export function parseListingFilters(url: URL): ListingFilters {
  const q = url.searchParams;
  const num = (k: string) => { const v = q.get(k); const n = v == null ? NaN : parseInt(v, 10); return Number.isFinite(n) ? n : undefined; };
  const str = (k: string) => q.get(k) || undefined;
  const f: ListingFilters = {};
  if (str('segment'))      f.segment = str('segment') as Segment;
  if (str('neighbourhood'))f.neighbourhood = str('neighbourhood');
  if (str('bhk'))          f.bhk = str('bhk');
  if (str('furnishing'))   f.furnishing = str('furnishing') as Furnishing;
  if (num('minRent') !== undefined) f.minRent = num('minRent');
  if (num('maxRent') !== undefined) f.maxRent = num('maxRent');
  if (num('page') !== undefined)    f.page = num('page');
  return f;
}
```

- [ ] **Step 4: Run → passes.** `npm test`

- [ ] **Step 5: Commit.** `git add src/lib/sql.ts test/sql.test.ts && git commit -m "feat(db): pure listings query builder + card mapper (TDD)"`

### Task 1.4: D1 executors + middleware

**Files:** Create `src/lib/db.ts`, `src/middleware.ts`

- [ ] **Step 1: Implement `src/lib/db.ts`** using the Task 1.3 builders (signatures match the frozen contract):
```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { ListingFilters, ListingCard, Property, PropertyMedia, Neighbourhood } from './types';
import { buildListingsQuery, mapRowToCard } from './sql';

export function getDb(locals: App.Locals): D1Database { return locals.db; }

export async function listListings(db: D1Database, f: ListingFilters) {
  const q = buildListingsQuery(f);
  const [rows, count] = await db.batch([
    db.prepare(q.sql).bind(...q.params),
    db.prepare(q.countSql).bind(...q.countParams),
  ]);
  const items = (rows.results as Record<string, any>[]).map(mapRowToCard);
  const total = (count.results as { n: number }[])[0]?.n ?? 0;
  return { items, total };
}

export async function getListingBySlug(db: D1Database, slug: string) {
  const property = await db.prepare('SELECT * FROM properties WHERE slug = ? AND published = 1').bind(slug).first<Property>();
  if (!property) return null;
  const media = await db.prepare('SELECT * FROM property_media WHERE property_id = ? ORDER BY display_order ASC').bind(property.id).all<PropertyMedia>();
  const neighbourhood = await db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(property.neighbourhood_slug).first<Neighbourhood>();
  return { property, media: media.results ?? [], neighbourhood: neighbourhood! };
}

export async function listNeighbourhoods(db: D1Database) {
  const r = await db.prepare('SELECT * FROM neighbourhoods ORDER BY display_order ASC').all<Neighbourhood>();
  return r.results ?? [];
}
export async function getNeighbourhood(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM neighbourhoods WHERE slug = ?').bind(slug).first<Neighbourhood>();
}
export async function featuredListings(db: D1Database, limit: number) {
  const { sql, params } = buildListingsQuery({ perPage: limit, page: 1 });
  const r = await db.prepare(sql).bind(...params).all<Record<string, any>>();
  return (r.results ?? []).map(mapRowToCard);
}
```

- [ ] **Step 2: `src/middleware.ts`** — attach `db` + `siteOrigin` to locals:
```ts
import { defineMiddleware } from 'astro:middleware';
export const onRequest = defineMiddleware(async (ctx, next) => {
  const env = ctx.locals.runtime.env;
  ctx.locals.db = env.DB;
  ctx.locals.siteOrigin = new URL(ctx.request.url).origin;
  return next();
});
```

- [ ] **Step 3: Verify it compiles + a temp page reads listings.** Temporarily add to `src/pages/index.astro`: `const { items } = await listListings(Astro.locals.db, {});` and render `items.length`. With an empty DB it should render `0` (not error).
Run: `npm run build && npx wrangler pages dev ./dist` → `/` shows `0`. Revert the temp code.

- [ ] **Step 4: Commit.** `git add src/lib/db.ts src/middleware.ts && git commit -m "feat(db): D1 executors + locals middleware"`

---

## Phase 2 — Import & seed scripts

> **Inputs required before running 2.3–2.5 (hard blockers):** the real `data/listings.xlsx`, and the per-listing photo folders at `data/listings/<slug>/` (folder name = `properties.slug`). Tasks 2.1, 2.2, 2.4 (pure helpers + tests) can be done without the inputs; Tasks 2.3 and 2.5 (which apply to D1/R2) cannot. Order within the phase: 2.1 → 2.2 → **2.3 (apply properties)** → 2.4 → **2.5 (apply media, depends on 2.3)**.

### Task 2.1: Slug + display-id generation (TDD)

**Files:** Create `scripts/lib/transform.ts`, `test/transform.test.ts`

- [ ] **Step 1: Failing tests:**
```ts
import { expect, test, describe } from 'vitest';
import { slugify, makeDisplayId } from '../scripts/lib/transform';
describe('slugify', () => {
  test('kebab-cases and strips punctuation', () => expect(slugify('2BHK Furnished, Gulab Garh!')).toBe('2bhk-furnished-gulab-garh'));
  test('appends a numeric suffix for uniqueness', () => expect(slugify('Office MI Road', 3)).toBe('office-mi-road-03'));
});
describe('makeDisplayId', () => {
  test('zero-pads to 2 digits with hash', () => expect(makeDisplayId(1)).toBe('#01'));
});
```

- [ ] **Step 2: Run → fails.** `npm test`

- [ ] **Step 3: Implement (in `scripts/lib/transform.ts`):**
```ts
export function slugify(text: string, suffix?: number): string {
  const base = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return suffix == null ? base : `${base}-${String(suffix).padStart(2, '0')}`;
}
export function makeDisplayId(n: number): string { return `#${String(n).padStart(2, '0')}`; }
```

- [ ] **Step 4: Run → passes.** `npm test`
- [ ] **Step 5: Commit.** `git add scripts/lib/transform.ts test/transform.test.ts && git commit -m "feat(import): slug + display-id helpers (TDD)"`

### Task 2.2: Enum normalisation + row→Property mapping (TDD)

**Files:** Modify `scripts/lib/transform.ts`, `test/transform.test.ts`

- [ ] **Step 1: Add failing tests:**
```ts
import { normalizeFurnishing, normalizeSegment, normalizeStatus, rowToProperty } from '../scripts/lib/transform';
describe('enum normalisation', () => {
  test('furnishing synonyms', () => { expect(normalizeFurnishing('Semi Furnished')).toBe('semi-furnished'); expect(normalizeFurnishing('FULLY FURNISHED')).toBe('furnished'); });
  test('segment from property type', () => { expect(normalizeSegment('Office')).toBe('commercial'); expect(normalizeSegment('2BHK Apartment')).toBe('residential'); });
  test('status synonyms + default', () => {
    expect(normalizeStatus('Rented')).toBe('rented');
    expect(normalizeStatus('On Hold')).toBe('on-hold');
    expect(normalizeStatus('Available')).toBe('available');
    expect(normalizeStatus('anything else')).toBe('available');
  });
});
describe('rowToProperty', () => {
  test('maps a spreadsheet row to a Property', () => {
    const p = rowToProperty({ Title: '2BHK Furnished Gulab Garh', BHK: '2BHK', Type: 'Apartment', Rent: '35,000', Area: '1100', Furnishing: 'Furnished', Landmark: 'near Gulab Garh', Neighbourhood: 'Mansarovar', Status: 'Available', Description: 'Nice flat' }, 1);
    expect(p.display_id).toBe('#01');
    expect(p.slug).toBe('2bhk-furnished-gulab-garh-01');
    expect(p.segment).toBe('residential');
    expect(p.rent_inr).toBe(35000);
    expect(p.area_sqft).toBe(1100);
    expect(p.neighbourhood_slug).toBe('mansarovar');
    expect(p.published).toBe(1);
  });
});
```

- [ ] **Step 2: Run → fails.** `npm test`

- [ ] **Step 3: Implement (append to `scripts/lib/transform.ts`).** `rowToProperty` uses `slugify`/`makeDisplayId`, parses `Rent`/`Area` by stripping non-digits, lowercases `Neighbourhood` via `slugify` (no suffix), and generates `id` via `crypto.randomUUID()`. Map the column names to match the real spreadsheet headers gathered in Task 2.3 Step 1 — **adjust the keys here once headers are known**:
```ts
import type { Property, Segment, Furnishing, Status } from '../../src/lib/types';
const toInt = (v: unknown) => parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10) || 0;
export function normalizeFurnishing(v: string): Furnishing {
  const s = v.toLowerCase();
  if (s.includes('semi')) return 'semi-furnished';
  if (s.includes('unfurnished') || s.includes('bare')) return 'unfurnished';
  return 'furnished';
}
export function normalizeSegment(typeOrTitle: string): Segment {
  return /office|shop|retail|commercial|showroom|warehouse/i.test(typeOrTitle) ? 'commercial' : 'residential';
}
export function normalizeStatus(v: string): Status {
  const s = (v || '').toLowerCase();
  if (s.includes('rent')) return 'rented';
  if (s.includes('hold')) return 'on-hold';
  return 'available';
}
export function rowToProperty(row: Record<string, any>, n: number): Property {
  const title = String(row.Title ?? '').trim();
  return {
    id: crypto.randomUUID(), display_id: makeDisplayId(n),
    segment: normalizeSegment(`${row.Type} ${title}`),
    bhk_type: row.BHK ? String(row.BHK).toUpperCase() : null,
    property_type: String(row.Type ?? 'apartment').toLowerCase(),
    rent_inr: toInt(row.Rent), area_sqft: row.Area ? toInt(row.Area) : null,
    furnishing: row.Furnishing ? normalizeFurnishing(String(row.Furnishing)) : null,
    status: normalizeStatus(String(row.Status ?? 'Available')),
    landmark: row.Landmark ? String(row.Landmark) : null,
    neighbourhood_slug: slugify(String(row.Neighbourhood ?? '')),
    map_url: row.MapUrl ? String(row.MapUrl) : null,
    description: row.Description ? String(row.Description) : null,
    slug: slugify(title, n), published: 1, created_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run → passes.** `npm test`
- [ ] **Step 5: Commit.** `git add scripts/lib/transform.ts test/transform.test.ts && git commit -m "feat(import): enum + row->Property mapping (TDD)"`

### Task 2.3: Excel → seed.sql importer

**Files:** Create `scripts/import-excel.mjs`, `seed/properties.sql` (generated, git-ignored)

- [ ] **Step 1: Inspect the real spreadsheet headers FIRST.** Place the file at `data/listings.xlsx`. Print its headers + one row and **reconcile the column keys in Task 2.2's `rowToProperty`** to match before proceeding:
```bash
node -e "const X=require('./scripts/lib/xlsx.cjs');const wb=X.readFile('data/listings.xlsx');const s=wb.Sheets[wb.SheetNames[0]];console.log(X.utils.sheet_to_json(s)[0])"
```
(If the SheetJS shim isn't installed yet, do Step 2 first.)

- [ ] **Step 2: Install SheetJS from the CDN tarball (NOT npm — npm build is stale/CVE):**
```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

- [ ] **Step 3: Write `scripts/import-excel.mjs`:**
```js
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { rowToProperty, slugify } from './lib/transform.ts';   // run via tsx (Step 5)

const wb = XLSX.readFile('data/listings.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const props = rows.map((r, i) => rowToProperty(r, i + 1));

const esc = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const nbhds = [...new Map(props.map((p) => [p.neighbourhood_slug, { slug: p.neighbourhood_slug, name: p.neighbourhood_slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }])).values()];

let sql = '';
nbhds.forEach((n, i) => {
  sql += `INSERT INTO neighbourhoods (slug,name,display_order) VALUES (${esc(n.slug)},${esc(n.name)},${i})\n  ON CONFLICT(slug) DO UPDATE SET name=excluded.name;\n`;
});
for (const p of props) {
  sql += `INSERT INTO properties (id,display_id,segment,bhk_type,property_type,rent_inr,area_sqft,furnishing,status,landmark,neighbourhood_slug,map_url,description,slug,published,created_at) VALUES (`
    + [p.id,p.display_id,p.segment,p.bhk_type,p.property_type,p.rent_inr,p.area_sqft,p.furnishing,p.status,p.landmark,p.neighbourhood_slug,p.map_url,p.description,p.slug,p.published,p.created_at]
        .map((v) => typeof v === 'number' ? v : esc(v)).join(',')
    + `)\n  ON CONFLICT(slug) DO UPDATE SET rent_inr=excluded.rent_inr,status=excluded.status,published=excluded.published;\n`;
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/properties.sql', sql);
console.log(`wrote seed/properties.sql: ${props.length} properties, ${nbhds.length} neighbourhoods`);
```
Add `seed/` to `.gitignore`. Add `tsx` for running TS imports from mjs: `npm install -D tsx`.

- [ ] **Step 4: Generate the SQL.** `npx tsx scripts/import-excel.mjs`
Expected: `wrote seed/properties.sql: N properties, M neighbourhoods` with N matching your spreadsheet row count.

- [ ] **Step 5: Apply to D1 (local + remote).**
```bash
npx wrangler d1 execute rentoo-listings --local  --file=seed/properties.sql
npx wrangler d1 execute rentoo-listings --remote --file=seed/properties.sql
```
Verify: `npx wrangler d1 execute rentoo-listings --remote --command "SELECT COUNT(*) FROM properties"` → equals N.

- [ ] **Step 6: Commit the script (not the generated SQL or data).** `git add scripts/import-excel.mjs .gitignore package.json package-lock.json && git commit -m "feat(import): xlsx -> seed.sql importer"`

### Task 2.4: Photo helpers — r2 key, cover/order, watermark plan (TDD)

**Files:** Modify `scripts/lib/transform.ts`, `test/transform.test.ts`; Create `assets/watermark.png`

- [ ] **Step 1: Create the watermark asset** from the existing icon (semi-transparent):
```bash
npx sharp-cli -i Rentooicon.png -o assets/watermark.png resize 180 180 || node -e "require('sharp')('Rentooicon.png').resize(180).png().toFile('assets/watermark.png')"
```

- [ ] **Step 2: Failing tests:**
```ts
import { r2KeyFor, coverAndOrder } from '../scripts/lib/transform';
describe('r2KeyFor', () => {
  test('builds base + size path', () => expect(r2KeyFor('2bhk-gulab-garh-01', 0, 'card')).toBe('properties/2bhk-gulab-garh-01/0-card.webp'));
});
describe('coverAndOrder', () => {
  test('marks *-cover file as cover, else first file', () => {
    expect(coverAndOrder(['b.jpg', 'a-cover.jpg', 'c.jpg'])).toEqual([
      { file: 'a-cover.jpg', index: 0, isCover: true },
      { file: 'b.jpg', index: 1, isCover: false },
      { file: 'c.jpg', index: 2, isCover: false },
    ]);
  });
  test('first file is cover when none marked', () => {
    expect(coverAndOrder(['x.jpg', 'y.jpg'])[0]).toEqual({ file: 'x.jpg', index: 0, isCover: true });
  });
});
```

- [ ] **Step 3: Run → fails.** `npm test`

- [ ] **Step 4: Implement (append to `transform.ts`):**
```ts
import type { MediaSize } from '../../src/lib/types';
export function r2KeyFor(slug: string, index: number, size: MediaSize): string {
  return `properties/${slug}/${index}-${size}.webp`;
}
export function coverAndOrder(files: string[]): { file: string; index: number; isCover: boolean }[] {
  const marked = files.filter((f) => /-cover\.[a-z]+$/i.test(f));
  const rest = files.filter((f) => !/-cover\.[a-z]+$/i.test(f)).sort();
  const ordered = [...marked.sort(), ...rest];
  return ordered.map((file, index) => ({ file, index, isCover: index === 0 }));
}
```

- [ ] **Step 5: Run → passes.** `npm test`
- [ ] **Step 6: Commit.** `git add scripts/lib/transform.ts test/transform.test.ts assets/watermark.png && git commit -m "feat(photos): r2-key + cover/order helpers (TDD)"`

### Task 2.5: Photo → R2 seed pipeline

**Files:** Create `scripts/seed-photos.mjs`, `.env.local` (git-ignored)

- [ ] **Step 1: R2 S3 credentials.** Create an R2 API token (Access Key ID + Secret) in the Cloudflare dashboard; put in `.env.local`:
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=rentoo-photos
```

- [ ] **Step 2: Write `scripts/seed-photos.mjs`** (sizes `card`=400w, `gallery`=1000w, `full`=1600w; watermark loaded once; idempotent via `HeadObject`):
```js
import 'dotenv/config';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { coverAndOrder, r2KeyFor } from './lib/transform.ts';

const SIZES = { card: 400, gallery: 1000, full: 1600 };
const ROOT = 'data/listings';
const watermark = readFileSync('assets/watermark.png');
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const Bucket = process.env.R2_BUCKET;

async function exists(Key) { try { await s3.send(new HeadObjectCommand({ Bucket, Key })); return true; } catch { return false; } }
const esc = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
let sql = '';

for (const slug of readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory())) {
  const files = readdirSync(join(ROOT, slug)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  for (const { file, index, isCover } of coverAndOrder(files)) {
    const src = join(ROOT, slug, file);
    let cardMeta = null;
    for (const [size, w] of Object.entries(SIZES)) {
      const Key = r2KeyFor(slug, index, size);
      if (await exists(Key)) continue;          // idempotent
      const img = sharp(src).rotate().resize({ width: w, withoutEnlargement: true })
        .composite([{ input: watermark, gravity: 'southeast' }]).webp({ quality: 82 });
      const buf = await img.toBuffer({ resolveWithObject: true });
      if (size === 'card') cardMeta = buf.info;
      await s3.send(new PutObjectCommand({ Bucket, Key, Body: buf.data, ContentType: 'image/webp' }));
      console.log('put', Key);
    }
    const base = `properties/${slug}/${index}`;
    sql += `INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked)\n`
      + `  SELECT lower(hex(randomblob(16))), id, 'photo', ${esc(base)}, ${index}, ${isCover ? 1 : 0}, ${cardMeta?.width ?? 'NULL'}, ${cardMeta?.height ?? 'NULL'}, 1 FROM properties WHERE slug=${esc(slug)}\n`
      + `  ON CONFLICT DO NOTHING;\n`;
  }
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/media.sql', sql);
console.log('wrote seed/media.sql');
```
Install dotenv: `npm install -D dotenv`.

> **PREREQUISITE — this task runs AFTER Task 2.3 is fully applied.** The media insert uses `... SELECT id FROM properties WHERE slug=?`, so the `properties` rows must already exist in D1 (local + remote). Do not start Task 2.5 until Task 2.3 Step 5 has succeeded. The folder names under `data/listings/<slug>/` must exactly match `properties.slug`.

- [ ] **Step 3: Create + apply the unique-index migration** (the media `ON CONFLICT DO NOTHING` depends on it). Write `migrations/0002_media_unique.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_key ON property_media(r2_key);
```
Apply it before seeding media:
```bash
npx wrangler d1 execute rentoo-listings --local  --file=migrations/0002_media_unique.sql
npx wrangler d1 execute rentoo-listings --remote --file=migrations/0002_media_unique.sql
```

- [ ] **Step 4: Run the pipeline** (photos already placed under `data/listings/<slug>/`):
```bash
npx tsx scripts/seed-photos.mjs
npx wrangler d1 execute rentoo-listings --local  --file=seed/media.sql
npx wrangler d1 execute rentoo-listings --remote --file=seed/media.sql
```
Expected: WebP objects appear in R2 (`npx wrangler r2 object get rentoo-photos/<a-key> --remote` or dashboard) and `SELECT COUNT(*) FROM property_media` is non-zero with exactly one `is_cover=1` per listing.

- [ ] **Step 5: Re-run to confirm idempotency.** `npx tsx scripts/seed-photos.mjs` → Expected: every `put` line is skipped (objects already exist), so no new uploads. Re-applying `seed/media.sql` errors-free (`ON CONFLICT DO NOTHING`); `SELECT COUNT(*) FROM property_media` is unchanged.

- [ ] **Step 6: Commit.** `git add scripts/seed-photos.mjs migrations/0002_media_unique.sql package.json package-lock.json && git commit -m "feat(photos): watermark + resize -> R2 seed pipeline (idempotent)"`

---

## Phase 3 — Image serving

### Task 3.1: `/media/[...key]` endpoint

**Files:** Create `src/pages/media/[...key].ts`

- [ ] **Step 1: Implement the endpoint** (reuses `isAllowedReferer` from Task 1.2). NOTE: bindings are accessed via `import { env } from 'cloudflare:workers'` — `Astro.locals.runtime.env` was removed in Astro v6. `locals.siteOrigin` is still set by the middleware.
```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAllowedReferer } from '../../lib/media';
export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key;                        // e.g. "properties/<slug>/0-card.webp"
  if (!key) return new Response('Not found', { status: 404 });
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response('Forbidden', { status: 403 });
  const obj = await (env as unknown as Env).MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': obj.httpEtag,
    },
  });
};
```

- [ ] **Step 2: Verify against real R2.**
```bash
npm run build && npx wrangler dev   # Workers dev; serves the built worker with R2 binding
```
Open `/media/properties/<a-real-slug>/0-card.webp` in the browser. Expected: the watermarked WebP renders. A `curl -H 'Referer: https://evil.example/' <url>` returns 403; no-referer `curl` returns 200.

- [ ] **Step 3: Commit.** `git add 'src/pages/media/[...key].ts' && git commit -m "feat(media): R2 image endpoint with referer guard + immutable cache"`

---

## Phase 4 — Layout & shared components

> **Porting rule for Phase 4–5:** the current static HTML files are the **design source of truth**. For each component/page, copy the relevant markup from the named existing file into the Astro component, then (a) replace hard-coded values with props/data, (b) replace `class="..."` that referenced `styles.css` with the equivalent Tailwind token classes (or keep a scoped `<style>` that uses the CSS vars — both are acceptable; prefer Tailwind utilities for layout, scoped styles for bespoke bits), (c) replace `/rentoo/...` asset paths with root `/...`, and (d) replace `picsum.photos` images with `mediaUrl(cover_key, 'card')`. Verify each against the original page visually.

### Task 4.1: BaseLayout

**Files:** Create `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Build the layout** — `<head>` (charset, viewport, `<title>`/meta from props, `import '../styles/globals.css'`, the Space Grotesk link), a skip-link, `<slot name="header" />`, `<main><slot /></main>`, `<slot name="footer" />`. Port `<head>` specifics from `index.html` lines 1–40.
- [ ] **Step 2: Props interface:** `interface Props { title: string; description?: string; }`.
- [ ] **Step 3: Verify** a temp page using the layout renders title + sandstone bg. `npm run dev`.
- [ ] **Step 4: Commit.** `git add src/layouts/BaseLayout.astro && git commit -m "feat(ui): BaseLayout"`

### Task 4.2: SiteHeader + mobile nav island

**Files:** Create `src/components/SiteHeader.astro`, `src/components/MobileNav.tsx`

- [ ] **Step 1: Port the header/nav markup** from `index.html` (`.site-header`, `.primary-nav`, `.logo` — note the working hamburger added in commit `0d5180c`). Desktop nav is static Astro. Logo `<img src="/Rentoo.png">`.
- [ ] **Step 2: Mobile nav as a shadcn `Sheet` island.** Add the component: `npx shadcn@latest add sheet`. `MobileNav.tsx` has props `interface Props { links: Array<{ label: string; href: string }> }`; it renders a hamburger button that opens a `Sheet` listing those links. Mount in the header with `client:visible`, passing the same nav links the desktop nav uses.
- [ ] **Step 3: Verify** at mobile width the hamburger opens/closes the sheet; at desktop the inline nav shows. `npm run dev`, resize.
- [ ] **Step 4: Commit.** `git add src/components/SiteHeader.astro src/components/MobileNav.tsx src/components/ui/sheet.tsx && git commit -m "feat(ui): site header + mobile nav island"`

### Task 4.3: SiteFooter

**Files:** Create `src/components/SiteFooter.astro`

- [ ] **Step 1: Port** `.site-footer` markup from `index.html` (footer columns, brand, base line, `connect@rentoo.in`). Static.
- [ ] **Step 2: Verify** renders. **Step 3: Commit.** `git add src/components/SiteFooter.astro && git commit -m "feat(ui): site footer"`

### Task 4.4: SectionMarker + Pill primitives

**Files:** Create `src/components/SectionMarker.astro`, `src/components/Pill.astro`

- [ ] **Step 1: `SectionMarker.astro`** — props `{ num?: string; label: string; meta?: string }`; mono uppercase styling (port from `.section-marker` in `index.html`).
- [ ] **Step 2: `Pill.astro`** — props `{ variant: 'status-available'|'status-rented'|'status-on-hold'|'verified'|'display-id'; label: string }`; port `.status-pill`, `.verified-pill`, `.display-id-tag` styles, switching colour by variant (available→green tokens, rented→rest-gray, on-hold→focus).
- [ ] **Step 3: Verify** all variants render with correct colours on a temp page.
- [ ] **Step 4: Commit.** `git add src/components/SectionMarker.astro src/components/Pill.astro && git commit -m "feat(ui): section marker + pill primitives"`

### Task 4.5: PropertyCard

**Files:** Create `src/components/PropertyCard.astro`

- [ ] **Step 1: Build from the `ListingCard` contract.** Props `{ card: ListingCard }`. Derive the link from the card's own segment — no extra prop:
```astro
---
import { mediaUrl } from '../lib/media';
import type { ListingCard } from '../lib/types';
const { card } = Astro.props as { card: ListingCard };
const href = `${card.segment === 'commercial' ? '/commercial' : '/rent'}/${card.slug}`;
const cover = card.cover_key ? mediaUrl(card.cover_key, 'card') : null;
---
```
Port `.property-card` markup from `rent/.../index.html` (card-image, display-id tag, status pill, price-row, card-title, card-landmark, card-meta-row). Image: `cover ? <img src={cover} width={card.cover_w ?? 400} height={card.cover_h ?? 280} loading="lazy" alt={card.title} /> : <div class="card-image-placeholder" />`. Wrap in `<a href={href}>`. Price formatted `₹{card.rent_inr.toLocaleString('en-IN')}`.
- [ ] **Step 2: Verify** by rendering a hard-coded sample `ListingCard` on a temp page — matches the original card visually (navy text, sandstone, 10px radius, status pill).
- [ ] **Step 3: Commit.** `git add src/components/PropertyCard.astro && git commit -m "feat(ui): PropertyCard from ListingCard contract"`

---

## Phase 5 — Pages

> **Build order (resolves island dependencies):** build the interactive pieces — Task 5.2 `FilterBar` and Task 5.3 `Gallery` — **before** the pages that mount them (5.4 `/rent`, 5.5 detail). The home page (5.1) mounts no island. The Phase 4 porting rule applies to every page below. Per spec §8: `FilterBar`, `MobileNav`, `ContactDialog` are React (shadcn) islands; the **`Gallery` is vanilla JS, not React**.

### Task 5.1: Home `/` (SSR)

**Files:** Modify `src/pages/index.astro`

- [ ] **Step 1: `export const prerender = false;`** (server-render — keeps featured listings always fresh and avoids any build-time-binding question; the homepage is cheap to render). Port the homepage sections from `index.html` (hero + search, recently-added/viewed grids, areas, editorial, testimonials, curator-signoff) into the page using `BaseLayout`, `SiteHeader`, `SiteFooter`, `SectionMarker`, `PropertyCard`.
- [ ] **Step 2: Featured listings from D1:** `const featured = await featuredListings(Astro.locals.db, 6);` then render `featured.map(card => <PropertyCard card={card} />)`.
- [ ] **Step 3: Verify** `npm run build && npx wrangler pages dev ./dist` → `/` shows the full homepage with real listing cards + real cover photos, no console errors.
- [ ] **Step 4: Commit.** `git add src/pages/index.astro && git commit -m "feat(pages): dynamic homepage (SSR)"`

### Task 5.2: FilterBar island (build before /rent)

**Files:** Create `src/components/FilterBar.tsx`

- [ ] **Step 1: Add shadcn primitives.** `npx shadcn@latest add select input`. Props:
```tsx
import type { ListingFilters, Neighbourhood } from '@/lib/types';
// listNeighbourhoods() returns Neighbourhood[] — a superset of {slug,name}; FilterBar reads only slug + name.
interface Props { neighbourhoods: Pick<Neighbourhood, 'slug' | 'name'>[]; value: ListingFilters }
```
- [ ] **Step 2: Implement** shadcn `Select`s for neighbourhood / BHK / furnishing + min/max rent `Input`s, initialised from `value`. On change, rebuild the query string and navigate: `const p = new URLSearchParams(window.location.search); p.set('neighbourhood', slug); /* etc; delete empties; reset page */ window.location.search = p.toString();` — the SSR `/rent` page re-renders filtered. No client data-fetch in milestone 1.
- [ ] **Step 3: Verify** rendering it on a temp page produces styled selects; selecting a value changes `window.location.search`.
- [ ] **Step 4: Commit.** `git add src/components/FilterBar.tsx src/components/ui/select.tsx src/components/ui/input.tsx && git commit -m "feat(ui): listing filter island"`

### Task 5.3: Gallery (vanilla JS, build before detail page)

**Files:** Create `src/components/Gallery.astro`

- [ ] **Step 1: Build a vanilla Astro component** (no React — spec §8). Props:
```astro
---
interface Props { images: { gallery: string; full: string; alt: string }[] }
const { images } = Astro.props;
const cover = images[0];
---
<div class="gallery" data-gallery>
  <img class="gallery-main" data-gallery-main src={cover?.gallery} alt={cover?.alt} width="1000" height="667" />
  <div class="gallery-thumbs">
    {images.map((img, i) => (
      <button class="gallery-thumb" data-gallery-thumb data-full={img.gallery} aria-label={`Photo ${i + 1}`} aria-current={i === 0}>
        <img src={img.gallery} alt={img.alt} width="120" height="80" loading="lazy" />
      </button>
    ))}
  </div>
</div>
<script>
  document.querySelectorAll('[data-gallery]').forEach((g) => {
    const main = g.querySelector('[data-gallery-main]');
    g.querySelectorAll('[data-gallery-thumb]').forEach((t) => {
      t.addEventListener('click', () => {
        if (main) main.src = t.getAttribute('data-full');
        g.querySelectorAll('[data-gallery-thumb]').forEach((x) => x.setAttribute('aria-current', 'false'));
        t.setAttribute('aria-current', 'true');
      });
    });
  });
</script>
```
- [ ] **Step 2: Verify** on a temp page with sample images, clicking a thumbnail swaps the main image. (Astro hoists the `<script>` automatically — no `client:*` directive needed.)
- [ ] **Step 3: Commit.** `git add src/components/Gallery.astro && git commit -m "feat(ui): listing detail gallery (vanilla JS)"`

### Task 5.4: Listing index `/rent` (SSR) + filtering

**Files:** Create `src/pages/rent/index.astro`

- [ ] **Step 1: `export const prerender = false;`** Parse filters with the pure helper and query D1:
```ts
import { parseListingFilters } from '../../lib/sql';
import { listListings, listNeighbourhoods } from '../../lib/db';
const filters = parseListingFilters(Astro.url);
const { items, total } = await listListings(Astro.locals.db, filters);
const neighbourhoods = await listNeighbourhoods(Astro.locals.db);
const perPage = filters.perPage ?? 12;
const page = filters.page ?? 1;
const totalPages = Math.max(1, Math.ceil(total / perPage));
```
Render the card grid (`items.map(card => <PropertyCard card={card} />)`) + prev/next pagination that preserves the current query and sets `?page=`. Port the `.filter-*` shell + grid layout from `rent/index.html`.
- [ ] **Step 2: Mount `FilterBar`** (Task 5.2) `client:visible`: `<FilterBar client:visible neighbourhoods={neighbourhoods} value={filters} />`.
- [ ] **Step 3: Verify** `/rent` lists real listings; `?neighbourhood=mansarovar&maxRent=30000` filters server-side; pagination works.
- [ ] **Step 4: Commit.** `git add src/pages/rent/index.astro && git commit -m "feat(pages): /rent listing index with server-side filters"`

### Task 5.5: Listing detail `/rent/[slug]` (SSR)

**Files:** Create `src/pages/rent/[slug].astro`, `src/lib/site.ts`

- [ ] **Step 1: Site constants.** `src/lib/site.ts`: `export const WHATSAPP_NUMBER = '<E164_NO_PLUS>'; // e.g. 919812345678 — confirm with owner`.
- [ ] **Step 2: `export const prerender = false;`** Load + transform:
```ts
import { mediaUrl } from '../../lib/media';
import { getListingBySlug } from '../../lib/db';
import { WHATSAPP_NUMBER } from '../../lib/site';
const data = await getListingBySlug(Astro.locals.db, Astro.params.slug!);
if (!data) return Astro.redirect('/404', 404);
const { property, media, neighbourhood } = data;
const images = media.filter(m => m.kind === 'photo').map(m => ({
  gallery: mediaUrl(m.r2_key, 'gallery'),
  full: mediaUrl(m.r2_key, 'full'),
  alt: `${property.display_id} — ${property.bhk_type ?? property.property_type}`,
}));
const waText = encodeURIComponent(`Hi Rentoo, I'm interested in ${property.display_id} (${property.slug}).`);
const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`;
```
Port the detail markup from `rent/2bhk-furnished-apartment-gulab-garh-01/index.html`: price-block, spec rows (`.spec-row` from `property`), description, CTA/WhatsApp card (`href={waUrl}`), location card (`neighbourhood` + `map_url`).
- [ ] **Step 3: Mount `Gallery`** (Task 5.3): `<Gallery images={images} />` (vanilla — no `client:*`).
- [ ] **Step 4: Verify** a real listing renders with real photos, specs, working WhatsApp link; an unknown slug 404s.
- [ ] **Step 5: Commit.** `git add src/pages/rent/[slug].astro src/lib/site.ts && git commit -m "feat(pages): listing detail (SSR)"`

### Task 5.6: Commercial index + detail (SSR)

**Files:** Create `src/pages/commercial/index.astro`, `src/pages/commercial/[slug].astro`

- [ ] **Step 1: Index** mirrors `/rent` but forces `const filters = { ...parseListingFilters(Astro.url), segment: 'commercial' as const };`. `PropertyCard` derives its link from `card.segment` (→ `/commercial/<slug>`), so no extra prop is needed. Port the commercial-specific bits (price-per-sqft) from `commercial/index.html`.
- [ ] **Step 2: Detail** mirrors `/rent/[slug]` using `getListingBySlug`; additionally show `area_sqft` + price-per-sqft (`Math.round(property.rent_inr / property.area_sqft)` when `area_sqft`). Port from `commercial/office-mi-road-c-3/index.html`.
- [ ] **Step 3: Verify** both render commercial listings from D1 and link within `/commercial`.
- [ ] **Step 4: Commit.** `git add src/pages/commercial && git commit -m "feat(pages): commercial index + detail (SSR)"`

### Task 5.7: Neighbourhood `/neighbourhoods/[slug]` (SSR)

**Files:** Create `src/pages/neighbourhoods/[slug].astro`

- [ ] **Step 1: `export const prerender = false;`** `const n = await getNeighbourhood(Astro.locals.db, Astro.params.slug!); if (!n) return Astro.redirect('/404',404);` then `const { items } = await listListings(Astro.locals.db, { neighbourhood: n.slug });`. Port markup from `neighbourhoods/mansarovar/index.html`; render `items` with `PropertyCard`.
- [ ] **Step 2: Verify** the page renders the neighbourhood header + its listing cards.
- [ ] **Step 3: Commit.** `git add src/pages/neighbourhoods/[slug].astro && git commit -m "feat(pages): neighbourhood page (SSR)"`

### Task 5.8: Marketing pages (prerender) + ContactDialog island

**Files:** Create `src/pages/about.astro`, `src/pages/contact.astro`, `src/pages/privacy.astro`, `src/components/ContactDialog.tsx`

- [ ] **Step 1: ContactDialog island** (spec §8). `npx shadcn@latest add dialog`. Props `interface Props { whatsappUrl: string; phone?: string; email?: string }`; renders a "Contact us" trigger button opening a shadcn `Dialog` with WhatsApp / phone / email CTAs (build `whatsappUrl` from `WHATSAPP_NUMBER` in `src/lib/site.ts`).
- [ ] **Step 2: Marketing pages.** Each `export const prerender = true;` and ports its existing HTML (`about/index.html`, `contact/index.html`, `privacy/index.html`) into `BaseLayout` with header/footer. Port stats/facts (about) and numbered sections (privacy). On `contact.astro`, mount `<ContactDialog client:visible whatsappUrl={`https://wa.me/${WHATSAPP_NUMBER}`} email="connect@rentoo.in" />`.
- [ ] **Step 3: Verify** all three render at `/about`, `/contact`, `/privacy`; the contact dialog opens and the WhatsApp link works.
- [ ] **Step 4: Commit.** `git add src/pages/about.astro src/pages/contact.astro src/pages/privacy.astro src/components/ContactDialog.tsx src/components/ui/dialog.tsx && git commit -m "feat(pages): about/contact/privacy + contact dialog island"`

### Task 5.9: 404

**Files:** Create `src/pages/404.astro`

- [ ] **Step 1:** Port `404.html` into `BaseLayout`, `export const prerender = true;`.
- [ ] **Step 2: Verify** an unknown URL shows it. **Step 3: Commit.** `git add src/pages/404.astro && git commit -m "feat(pages): 404"`

---

## Phase 6 — Restrained motion accent (optional)

### Task 6.1: One Magic UI accent (skippable)

**Files:** Modify `src/pages/index.astro`

- [ ] **Step 1:** Pick **one** subtle effect for the homepage featured row (e.g. Magic UI "Blur Fade" reveal on scroll). Copy its source into `src/components/magic/` (Magic UI is copy-paste; ensure `framer-motion` is installed). Wrap the featured cards, `client:visible`. **Per spec §8, REJECT the flashy categories** — no confetti, meteors, flickering grids, morphing text, animated beams, or heavy parallax. They fight the clean, restrained aesthetic.
- [ ] **Step 2: Verify** the reveal is subtle, respects `prefers-reduced-motion`, and doesn't shift layout or hurt LCP; if it reads as "slop," **delete it** — this task is optional by design and skipping it is a valid outcome.
- [ ] **Step 3: Commit (if kept).** `git add -A && git commit -m "feat(ui): subtle featured-row reveal"`

---

## Phase 7 — Cutover & deploy

### Task 7.1: Remove the legacy static site

**Files:** Delete the old root HTML + `styles.css` (superseded by the Astro app)

- [ ] **Step 1:** The legacy static files are left **untouched through Phases 0–6** (Astro routes resolve before the old files, and the old files are never imported, so they don't interfere). Only now, after all pages are ported, confirm every old page has an Astro equivalent (checklist: `index`, `rent`, `rent/<detail>`, `commercial`, `commercial/<detail>`, `neighbourhoods/<slug>`, `about`, `contact`, `privacy`, `404`). The `admin/` and `preview/` folders are out of scope for milestone 1 — **leave them** (admin is milestone 2; preview is internal mockups).
- [ ] **Step 2: Delete** the now-duplicated root static files:
```bash
git rm 404.html index.html styles.css .nojekyll \
  about/index.html contact/index.html privacy/index.html \
  rent/index.html "rent/2bhk-furnished-apartment-gulab-garh-01/index.html" \
  commercial/index.html "commercial/office-mi-road-c-3/index.html" \
  neighbourhoods/mansarovar/index.html
```
(Keep `Rentoo.png`, `Rentooicon.png` — referenced by the app. Move them into `public/` so Astro serves them at root: `git mv Rentoo.png Rentooicon.png public/`, and update references to `/Rentoo.png`.)
- [ ] **Step 3: Verify** `npm run build` succeeds and `npx wrangler pages dev ./dist` serves every route with no 404s. Confirm no code still points at removed/old asset paths:
```bash
grep -rn "/rentoo/\|styles.css\|picsum.photos" src/ && echo "FOUND STALE REFS — fix them" || echo "clean"
grep -rn "Rentoo.png\|Rentooicon.png" src/   # every hit must be a root path like /Rentoo.png
```
Expected: the first prints `clean`; the second shows only `/Rentoo.png` / `/Rentooicon.png` style root paths.
- [ ] **Step 4: Commit.** `git commit -m "chore: remove legacy static site (superseded by Astro app)"`

### Task 7.2: Production deploy to rentoo.pages.dev

- [ ] **Step 1: Push the branch.** `git push origin milestone-1-dynamic` — the Pages git integration builds it. Verify the **preview URL** serves the full dynamic site with real photos.
- [ ] **Step 2: Full route smoke-test on the preview URL:** `/`, `/rent`, `/rent/<slug>`, `/commercial`, `/commercial/<slug>`, `/neighbourhoods/<slug>`, `/about`, `/contact`, `/privacy`, a `/media/...` image, and a 404. Confirm filters + pagination + gallery + mobile nav + WhatsApp link work.
- [ ] **Step 3: Promote to production.** Merge `milestone-1-dynamic` → `main` (or change the Pages production branch). Verify `https://rentoo.pages.dev` is live and correct.
- [ ] **Step 4: Tag the milestone.** `git tag milestone-1 && git push --tags`

### Task 7.3: Verification pass (acceptance)

- [ ] **Step 1: Visual parity** — compare `/`, `/rent`, a detail page, a neighbourhood, commercial against the original design (use the project's `design-review` tooling). No `picsum.photos` anywhere.
- [ ] **Step 2: Lighthouse** on `/` and `/rent` (preview URL) — performance + accessibility hold; static pages ship no unexpected JS (only the intended islands hydrate).
- [ ] **Step 3: Idempotency re-check** — re-run `import-excel.mjs` + `seed-photos.mjs`; confirm no duplicate rows/objects.
- [ ] **Step 4: Run the unit suite.** `npm test` → all green.

---

## Self-review — spec coverage

- Spec §3 rendering split → home SSR (5.1), listing/commercial/neighbourhood SSR (5.4–5.7), marketing prerender (5.8), 404 prerender (5.9). ✔
- Spec §4 data model → Task 1.1 (DDL) + 2.5 (0002 unique index). ✔
- Spec §5 photo pipeline + `/media` serving → Tasks 2.4/2.5 (pipeline) + 3.1 (serving). ✔
- Spec §6 Excel import → Tasks 2.1–2.3. ✔
- Spec §8 Tailwind theme + islands policy → Tasks 0.3/0.4 (theme); islands: MobileNav (4.2), FilterBar (5.2), ContactDialog (5.8), Magic UI accent (6.1); Gallery is vanilla (5.3) per spec. ✔
- Spec §7 routes → all in Phase 5 + `/media` (3.1). ✔
- Spec §9 repo structure → File-structure section + tasks create those paths. ✔
- Spec §10 deploy (git integration, bindings, nodejs_compat) → Tasks 0.5/0.7/7.2. ✔
- Spec §11 gotchas → embedded (platformProxy 0.2, pages_build_output_dir 0.5, SheetJS CDN 2.3, sharp buffer 2.5, FK app-side 2.2, CLS width/height 4.5, referer+cache 3.1). ✔
- Spec §12 inputs → Tasks 2.3 Step 1 (headers), 2.5 (photos), 2.4 Step 1 (watermark), 0.5 Step 1 (CF access), 5.5 Step 1 (WhatsApp number). ✔
- Spec §14 testing/acceptance → Task 7.3. ✔

**Inputs the executor must supply (blocking specific tasks):** the real `data/listings.xlsx` (Task 2.3) — reconcile `rowToProperty` keys to its headers; the photo folders under `data/listings/<slug>/` (Task 2.5); the WhatsApp number (`src/lib/site.ts`, Task 5.5); Cloudflare login + the D1 `database_id` + R2 API token (Tasks 0.5, 2.5).
