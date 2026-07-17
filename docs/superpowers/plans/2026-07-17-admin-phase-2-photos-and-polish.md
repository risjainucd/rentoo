# Admin Phase 2 — Photo Management + Design Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated admin add, delete, and reorder a listing's photos directly in the `/admin` portal (watermarked in the browser, stored in R2), and restyle the whole admin portal onto the site's design system.

**Architecture:** The admin's browser resizes + watermarks + WebP-encodes each photo via Canvas, then POSTs the three renditions to thin `/api/admin/photos/*` endpoints that `put()` to the R2 `MEDIA` binding and write `property_media` rows. Ordering is a pure function (`display_order` 0..n-1, cover = index 0); `r2_key` is a permanent opaque id so reorder never renames R2 objects. Delete is soft (DB row only). A new `AdminLayout.astro` imports `globals.css` so both admin pages inherit the site's tokens/fonts.

**Tech Stack:** Astro 6 SSR + Cloudflare Workers, D1 (`locals.db`), R2 (`env.MEDIA`), TypeScript, vitest (node env, pure-function unit tests), browser Canvas API.

## Global Constraints

- **No `sharp`, no WASM, no Cloudflare Images** — all image processing is client-side Canvas. Worker only validates + writes.
- **No new migration** — `property_media` already has every needed column (`id, property_id, kind, r2_key, display_order, is_cover, width, height, watermarked`).
- **All new routes live under `/api/admin/*`** — already Access-protected by `src/middleware.ts`; add no auth logic to routes.
- **R2 access at runtime is via `import { env } from 'cloudflare:workers'` → `(env as unknown as Env).MEDIA`** (same pattern as `src/pages/media/[...key].ts`). Never use S3 creds at runtime.
- **Rendition convention (unchanged):** base key `properties/<slug>/<id>`, objects `-{card,gallery,full}.webp` at widths 600 / 1200 / 2000. `mediaUrl()` appends the suffix.
- **Cover = `display_order 0`** (the site's `attachPhotos` already reads it this way). Exactly one `is_cover=1` per listing with ≥1 photo. No separate "set as cover" UI — drag to front.
- **Soft delete** — delete removes the `property_media` row only; R2 objects are retained.
- **HEIC/HEIF rejected client-side** with a clear message; JPEG/PNG/WebP accepted.
- **Design tokens** (from `src/styles/globals.css`): primary navy `--color-primary #082746`, secondary green `--color-secondary #16A34A`, accent terracotta `--color-accent #B5532E`, danger `--danger-red #DC2626`, paper `--color-background #FAF7EE`, card `--color-surface-card #FFFFFF`, borders `--color-border #E5E0D5`, input `--color-input #F1F5F9`, focus `--focus-clay #EA580C`; fonts `--font-sans` (Geist) body, `--font-display` (Space Grotesk) headings; radii `--r-sm/md/lg`, shadows `--elev-1/2/3`, `.btn-sheen` hover.
- **Verify auth on the real worker** (`npm run build && npx wrangler dev -c dist/server/wrangler.json`), never `astro dev` (middleware doesn't run for `/admin` under astro dev).

---

## File Structure

- **New (pure, unit-tested):** `src/lib/admin-photos.ts` — rendition plan, watermark geometry, order normalization, key generation. Node-safe (no DOM/D1 at module scope).
- **New (browser glue):** `src/lib/admin-photos-client.ts` — decode → render → watermark → encode → upload, plus grid reorder/delete wiring. Imports `admin-photos.ts`.
- **New (routes):** `src/pages/api/admin/photos/[slug].ts` (upload), `src/pages/api/admin/photos/[slug]/reorder.ts`, `src/pages/api/admin/photos/[slug]/delete.ts`.
- **New (layout):** `src/layouts/AdminLayout.astro`.
- **Edited:** `src/lib/db.ts` (+`addPhoto`, `reorderPhotos`, `deletePhoto`), `src/pages/admin/index.astro` (restyle), `src/pages/admin/[slug].astro` (restyle + photo panel, remove radio cover-picker).
- **New (tests):** `test/admin-photos.test.ts`.
- **Unchanged:** `src/middleware.ts`, `src/pages/media/[...key].ts`, `wrangler.jsonc`, migrations, `scripts/*`.

---

## Task 1: Pure helpers `src/lib/admin-photos.ts` (TDD)

**Files:**
- Create: `src/lib/admin-photos.ts`
- Test: `test/admin-photos.test.ts`

**Interfaces:**
- Consumes: `MediaSize` from `src/lib/types.ts`.
- Produces:
  - `RENDITIONS: { name: MediaSize; width: number; quality: number }[]`
  - `renditionPlan(srcWidth: number): { name: MediaSize; width: number; quality: number }[]`
  - `watermarkLayout(imgW: number, imgH: number, logoAspect: number): { w: number; h: number; left: number; top: number }`
  - `normalizePhotoOrder(ids: string[]): { id: string; display_order: number; is_cover: 0 | 1 }[]`
  - `photoBaseKey(slug: string, token: string): string`
  - `randomPhotoToken(): string`
  - constants `WORDMARK_FRAC`, `WHITE_OPACITY`, `SHADOW_OPACITY`

- [ ] **Step 1: Write the failing tests**

Create `test/admin-photos.test.ts`:

```ts
import { expect, test, describe } from 'vitest';
import {
  renditionPlan, watermarkLayout, normalizePhotoOrder, photoBaseKey, randomPhotoToken,
} from '../src/lib/admin-photos';

describe('renditionPlan', () => {
  test('uses full target widths for a large source', () => {
    expect(renditionPlan(4000).map((r) => [r.name, r.width])).toEqual([
      ['card', 600], ['gallery', 1200], ['full', 2000],
    ]);
  });
  test('never upscales past the source width', () => {
    expect(renditionPlan(800).map((r) => r.width)).toEqual([600, 800, 800]);
  });
});

describe('watermarkLayout', () => {
  test('centers a 0.6x-width wordmark on a landscape photo', () => {
    const l = watermarkLayout(1000, 750, 4); // logo aspect 4:1
    expect(l.w).toBe(600);            // 0.6 * 1000
    expect(l.h).toBe(150);            // 600 / 4
    expect(l.left).toBe(200);         // (1000-600)/2
    expect(l.top).toBe(300);          // (750-150)/2
  });
  test('clamps the wordmark to fit inside a tall/narrow photo', () => {
    const l = watermarkLayout(300, 1200, 4); // 0.6*300=180 wide, 45 tall — fits
    expect(l.w).toBeLessThanOrEqual(Math.round(300 * 0.92));
    expect(l.h).toBeLessThanOrEqual(Math.round(1200 * 0.92));
  });
  test('never smaller than the 80px floor at its target', () => {
    const l = watermarkLayout(100, 100, 4);
    expect(l.w).toBeGreaterThanOrEqual(80 - 100 * 0.08); // floor minus clamp headroom
  });
});

describe('normalizePhotoOrder', () => {
  test('assigns contiguous order and cover only to index 0', () => {
    expect(normalizePhotoOrder(['a', 'b', 'c'])).toEqual([
      { id: 'a', display_order: 0, is_cover: 1 },
      { id: 'b', display_order: 1, is_cover: 0 },
      { id: 'c', display_order: 2, is_cover: 0 },
    ]);
  });
  test('empty list yields empty plan', () => {
    expect(normalizePhotoOrder([])).toEqual([]);
  });
});

describe('photoBaseKey', () => {
  test('builds an opaque per-photo base key', () => {
    expect(photoBaseKey('2bhk-gulab-garh-01', 'abc123')).toBe('properties/2bhk-gulab-garh-01/u-abc123');
  });
  test('rejects a slug with illegal characters', () => {
    expect(() => photoBaseKey('../evil', 'x')).toThrow();
  });
});

describe('randomPhotoToken', () => {
  test('returns a 12-char lowercase hex token', () => {
    expect(randomPhotoToken()).toMatch(/^[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- admin-photos`
Expected: FAIL (`Cannot find module '../src/lib/admin-photos'`).

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin-photos.ts`:

```ts
import type { MediaSize } from './types';

// Watermark constants mirrored from scripts/_watermark.mjs so client output matches the offline pipeline.
export const WORDMARK_FRAC = 0.6;
export const WHITE_OPACITY = 0.18;
export const SHADOW_OPACITY = 0.22;

export const RENDITIONS: { name: MediaSize; width: number; quality: number }[] = [
  { name: 'card', width: 600, quality: 0.72 },
  { name: 'gallery', width: 1200, quality: 0.8 },
  { name: 'full', width: 2000, quality: 0.82 },
];

// Never upscale: each rendition is min(target, source width). Mirrors sharp's withoutEnlargement.
export function renditionPlan(srcWidth: number): { name: MediaSize; width: number; quality: number }[] {
  return RENDITIONS.map((r) => ({ ...r, width: Math.min(r.width, srcWidth) }));
}

// Centered wordmark box at 0.6x image width (min 80px), clamped to fit within 92% of the image.
export function watermarkLayout(imgW: number, imgH: number, logoAspect: number): { w: number; h: number; left: number; top: number } {
  let w = Math.max(80, Math.round(imgW * WORDMARK_FRAC));
  let h = Math.round(w / logoAspect);
  const maxW = imgW * 0.92, maxH = imgH * 0.92;
  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { w, h, left: Math.round((imgW - w) / 2), top: Math.round((imgH - h) / 2) };
}

// Ordering invariant source of truth: display_order = index, cover = index 0.
export function normalizePhotoOrder(ids: string[]): { id: string; display_order: number; is_cover: 0 | 1 }[] {
  return ids.map((id, i) => ({ id, display_order: i, is_cover: i === 0 ? 1 : 0 }));
}

const SLUG_RE = /^[a-z0-9-]+$/;
export function photoBaseKey(slug: string, token: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`bad slug: ${slug}`);
  return `properties/${slug}/u-${token}`;
}

export function randomPhotoToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- admin-photos`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-photos.ts test/admin-photos.test.ts
git commit -m "feat(admin): pure photo helpers (renditions, watermark geometry, ordering, keys)"
```

---

## Task 2: DB helpers `addPhoto` / `reorderPhotos` / `deletePhoto`

**Files:**
- Modify: `src/lib/db.ts` (append after `setCover`, ~line 114)

**Interfaces:**
- Consumes: `normalizePhotoOrder` from `src/lib/admin-photos.ts`; `PropertyMedia` from `src/lib/types.ts`; `D1Database` (ambient).
- Produces:
  - `addPhoto(db: D1Database, slug: string, r2_key: string, width: number | null, height: number | null): Promise<PropertyMedia | null>`
  - `reorderPhotos(db: D1Database, slug: string, ids: string[]): Promise<void>`
  - `deletePhoto(db: D1Database, slug: string, id: string): Promise<void>`

> These are thin D1 glue over the pure `normalizePhotoOrder` (which carries the invariant and is unit-tested in Task 1). The repo does not unit-test `db.ts` (no D1 harness); these are verified by the endpoint tests' shape and the manual e2e in Task 9, consistent with the existing `setCover`/`updateListingFields` which also have no unit tests.

- [ ] **Step 1: Add the import**

At the top of `src/lib/db.ts`, add to the existing imports:

```ts
import { normalizePhotoOrder } from './admin-photos';
```

(If `PropertyMedia` is not already imported in db.ts, add it to the existing `./types` import.)

- [ ] **Step 2: Append the three helpers**

Add after `setCover` (before `featuredListings`):

```ts
// Insert a photo at the end of the listing's photo order (never cover; caller reorders to promote).
export async function addPhoto(
  db: D1Database, slug: string, r2_key: string, width: number | null, height: number | null,
): Promise<PropertyMedia | null> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return null;
  const next = await db
    .prepare("SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM property_media WHERE property_id=? AND kind='photo'")
    .bind(prop.id).first<{ n: number }>();
  const display_order = next?.n ?? 0;
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO property_media (id, property_id, kind, r2_key, display_order, is_cover, width, height, watermarked) VALUES (?, ?, 'photo', ?, ?, 0, ?, ?, 1)",
  ).bind(id, prop.id, r2_key, display_order, width, height).run();
  return { id, property_id: prop.id, kind: 'photo', r2_key, display_order, is_cover: 0, width, height, watermarked: 1 };
}

// Apply an explicit order (array index = display_order; index 0 = cover). Ignores ids not on this listing.
export async function reorderPhotos(db: D1Database, slug: string, ids: string[]): Promise<void> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return;
  const owned = await db.prepare("SELECT id FROM property_media WHERE property_id=? AND kind='photo'").bind(prop.id).all<{ id: string }>();
  const valid = new Set((owned.results ?? []).map((r) => r.id));
  const plan = normalizePhotoOrder(ids.filter((i) => valid.has(i)));
  if (!plan.length) return;
  await db.batch(plan.map((p) =>
    db.prepare('UPDATE property_media SET display_order=?, is_cover=? WHERE id=? AND property_id=?').bind(p.display_order, p.is_cover, p.id, prop.id),
  ));
}

// Soft delete: remove the row only (R2 objects retained), then renormalize the remaining order + cover.
export async function deletePhoto(db: D1Database, slug: string, id: string): Promise<void> {
  const prop = await db.prepare('SELECT id FROM properties WHERE slug=?').bind(slug).first<{ id: string }>();
  if (!prop) return;
  await db.prepare("DELETE FROM property_media WHERE id=? AND property_id=? AND kind='photo'").bind(id, prop.id).run();
  const rest = await db.prepare("SELECT id FROM property_media WHERE property_id=? AND kind='photo' ORDER BY display_order ASC").bind(prop.id).all<{ id: string }>();
  const plan = normalizePhotoOrder((rest.results ?? []).map((r) => r.id));
  if (plan.length) {
    await db.batch(plan.map((p) =>
      db.prepare('UPDATE property_media SET display_order=?, is_cover=? WHERE id=?').bind(p.display_order, p.is_cover, p.id),
    ));
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(admin): db helpers addPhoto/reorderPhotos/deletePhoto (soft delete)"
```

---

## Task 3: Upload endpoint `POST /api/admin/photos/[slug]`

**Files:**
- Create: `src/pages/api/admin/photos/[slug].ts`

**Interfaces:**
- Consumes: `addPhoto` (Task 2); `photoBaseKey`, `randomPhotoToken` (Task 1); `env.MEDIA` (R2).
- Produces: `POST` route returning `{ ok: true, id, r2_key, display_order }` (200) or `{ ok: false, error }` (400/404).

- [ ] **Step 1: Write the endpoint**

Create `src/pages/api/admin/photos/[slug].ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { addPhoto } from '../../../../lib/db';
import { photoBaseKey, randomPhotoToken, RENDITIONS } from '../../../../lib/admin-photos';

export const prerender = false;

const MAX_BYTES = 3_000_000; // per rendition; watermarked WebP is well under this

export const POST: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug;
  if (!slug) return json({ ok: false, error: 'missing slug' }, 400);

  let base: string;
  try { base = photoBaseKey(slug, randomPhotoToken()); }
  catch { return json({ ok: false, error: 'bad slug' }, 400); }

  const form = await request.formData();
  const width = parseInt(String(form.get('width') || ''), 10) || null;
  const height = parseInt(String(form.get('height') || ''), 10) || null;

  // Collect + validate the three renditions before touching R2 or D1.
  const parts: { name: string; buf: ArrayBuffer }[] = [];
  for (const r of RENDITIONS) {
    const blob = form.get(r.name);
    if (!(blob instanceof File)) return json({ ok: false, error: `missing ${r.name}` }, 400);
    if (blob.type !== 'image/webp') return json({ ok: false, error: `${r.name} not webp` }, 400);
    if (blob.size === 0 || blob.size > MAX_BYTES) return json({ ok: false, error: `${r.name} size` }, 400);
    parts.push({ name: r.name, buf: await blob.arrayBuffer() });
  }

  const bucket = (env as unknown as Env).MEDIA;
  // Put all objects first, then insert the row — a failed put never orphans a DB row.
  for (const p of parts) {
    await bucket.put(`${base}-${p.name}.webp`, p.buf, { httpMetadata: { contentType: 'image/webp' } });
  }

  const row = await addPhoto(locals.db, slug, base, width, height);
  if (!row) return json({ ok: false, error: 'listing not found' }, 404);

  return json({ ok: true, id: row.id, r2_key: row.r2_key, display_order: row.display_order }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Build to confirm the route compiles into the worker**

Run: `npm run build`
Expected: build succeeds; no route errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/admin/photos/[slug].ts
git commit -m "feat(admin): photo upload endpoint (validate webp, put R2, insert row)"
```

---

## Task 4: Reorder + delete endpoints

**Files:**
- Create: `src/pages/api/admin/photos/[slug]/reorder.ts`
- Create: `src/pages/api/admin/photos/[slug]/delete.ts`

**Interfaces:**
- Consumes: `reorderPhotos`, `deletePhoto` (Task 2).
- Produces: two `POST` routes returning `{ ok: true }` (200) or `{ ok: false, error }` (400).

- [ ] **Step 1: Write the reorder endpoint**

Create `src/pages/api/admin/photos/[slug]/reorder.ts`:

```ts
import type { APIRoute } from 'astro';
import { reorderPhotos } from '../../../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug;
  if (!slug) return json({ ok: false, error: 'missing slug' }, 400);
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string') : null;
  if (!ids) return json({ ok: false, error: 'ids required' }, 400);
  await reorderPhotos(locals.db, slug, ids);
  return json({ ok: true }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Write the delete endpoint**

Create `src/pages/api/admin/photos/[slug]/delete.ts`:

```ts
import type { APIRoute } from 'astro';
import { deletePhoto } from '../../../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug;
  if (!slug) return json({ ok: false, error: 'missing slug' }, 400);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return json({ ok: false, error: 'id required' }, 400);
  await deletePhoto(locals.db, slug, id); // soft delete + renormalize; idempotent
  return json({ ok: true }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/admin/photos/[slug]/reorder.ts src/pages/api/admin/photos/[slug]/delete.ts
git commit -m "feat(admin): photo reorder + soft-delete endpoints"
```

---

## Task 5: `AdminLayout.astro`

**Files:**
- Create: `src/layouts/AdminLayout.astro`

**Interfaces:**
- Produces: an Astro layout with props `{ title: string; email?: string | null; back?: boolean }` and a default `<slot />`.

- [ ] **Step 1: Write the layout**

Create `src/layouts/AdminLayout.astro`:

```astro
---
import '../styles/globals.css';
interface Props { title: string; email?: string | null; back?: boolean; }
const { title, email = null, back = false } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="icon" type="image/png" href="/Rentooicon.png" />
    <title>{title}</title>
  </head>
  <body class="admin-body">
    <header class="admin-bar">
      <div class="brand">
        {back && <a class="back" href="/admin">← All listings</a>}
        <img src="/Rentoo.svg" alt="Rentoo" class="logo" />
        <span class="tag">Admin</span>
      </div>
      {email && <span class="who">{email}</span>}
    </header>
    <main class="admin-main"><slot /></main>
    <style>
      .admin-body { background: var(--color-background); color: var(--color-foreground); font-family: var(--font-sans); margin: 0; }
      .admin-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-lg);
        background: var(--color-primary); color: var(--color-primary-foreground);
        padding: var(--space-md) var(--space-xl); }
      .brand { display: flex; align-items: center; gap: var(--space-md); }
      .back { color: var(--color-primary-foreground); opacity: .8; text-decoration: none; font-size: .85rem; margin-right: var(--space-sm); }
      .back:hover { opacity: 1; }
      .logo { height: 26px; width: auto; display: block; }
      .tag { font-family: var(--font-display); font-size: .7rem; letter-spacing: .08em; text-transform: uppercase;
        border: 1px solid rgba(255,255,255,.35); border-radius: 99px; padding: 2px 9px; }
      .who { font-size: .8rem; opacity: .85; }
      .admin-main { max-width: var(--max-w); margin: 0 auto; padding: var(--space-xl) var(--gutter); }
    </style>
  </body>
</html>
```

- [ ] **Step 2: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/AdminLayout.astro
git commit -m "feat(admin): AdminLayout on the site design system (globals.css, slim bar)"
```

---

## Task 6: Restyle listings table `src/pages/admin/index.astro`

**Files:**
- Modify: `src/pages/admin/index.astro` (full rewrite of markup/styles; keep the frontmatter data logic)

**Interfaces:**
- Consumes: `AdminLayout` (Task 5); existing `listAllForAdmin` (unchanged).

- [ ] **Step 1: Rewrite the page onto AdminLayout + tokens**

Replace the entire contents of `src/pages/admin/index.astro` with:

```astro
---
export const prerender = false;
import AdminLayout from '../../layouts/AdminLayout.astro';
import { listAllForAdmin } from '../../lib/db';
const rows = await listAllForAdmin(Astro.locals.db);
const adminEmail = Astro.locals.adminEmail;
const rupees = (n: any) => `₹${Number(n).toLocaleString('en-IN')}`;
const title = (r: any) => [r.bhk_type, r.property_type].filter(Boolean).join(' ');
const viewPath = (r: any) => (r.segment === 'commercial' ? 'commercial' : r.segment === 'industrial' ? 'industrial' : 'rent');
---
<AdminLayout title="Rentoo Admin — Listings" email={adminEmail}>
  <h1 class="page-title">Listings</h1>
  <p class="count">{rows.length} listings</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>ID</th><th>Listing</th><th>Segment</th><th>Area</th><th>Rent</th><th>Status</th><th>Pub</th><th>Feat</th><th>Media</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td class="muted mono">{r.display_id}</td>
            <td class="strong">{title(r) || r.property_type}</td>
            <td><span class={`pill seg-${r.segment}`}>{r.segment}</span></td>
            <td class="muted">{r.neighbourhood_slug}</td>
            <td>{rupees(r.rent_inr)}</td>
            <td><span class={`st st-${r.status}`}>{r.status}</span></td>
            <td>{r.published ? <span class="yes">✓</span> : <span class="no">✕</span>}</td>
            <td>{r.featured ? <span class="yes">★</span> : <span class="no">—</span>}</td>
            <td>{r.photos > 0 ? <span class="muted">{r.photos}📷 {r.videos ? `${r.videos}🎬` : ''}</span> : <span class="needs">needs photos</span>}</td>
            <td class="actions">
              <a class="edit" href={`/admin/${r.slug}`}>Edit</a>
              <a class="view" href={`/${viewPath(r)}/${r.slug}`} target="_blank">view ↗</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  <style>
    .page-title { font-family: var(--font-display); font-size: 1.5rem; margin: 0 0 var(--space-xs); }
    .count { color: var(--ink-muted); font-size: .85rem; margin: 0 0 var(--space-lg); }
    .table-wrap { background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--r-lg); box-shadow: var(--elev-1); overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { font-family: var(--font-display); background: var(--color-surface-alt); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-muted); }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--color-surface-alt); }
    .strong { font-weight: 600; }
    .muted { color: var(--ink-muted); }
    .mono { font-family: var(--font-mono); font-size: .8rem; }
    .pill { font-size: .68rem; padding: 2px 9px; border-radius: 99px; font-weight: 600; text-transform: capitalize; }
    .seg-residential { background: var(--haze-tint); color: var(--jaipur-navy); }
    .seg-commercial { background: var(--ok-mist); color: var(--ok-green); }
    .seg-industrial { background: var(--terracotta-mist); color: var(--terracotta); }
    .st { font-weight: 600; text-transform: capitalize; }
    .st-available { color: var(--ok-green); }
    .st-rented { color: var(--danger-red); }
    .st-on-hold { color: #b45309; }
    .yes { color: var(--ok-green); font-weight: 700; }
    .no { color: var(--ink-soft); }
    .needs { color: var(--terracotta); font-weight: 600; font-size: .8rem; }
    .actions { display: flex; gap: var(--space-md); }
    .edit { color: var(--jaipur-navy); font-weight: 600; text-decoration: none; }
    .edit:hover { text-decoration: underline; }
    .view { color: var(--ink-muted); font-size: .8rem; text-decoration: none; }
    .view:hover { text-decoration: underline; }
  </style>
</AdminLayout>
```

- [ ] **Step 2: Typecheck + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "polish(admin): restyle listings table onto site tokens + needs-photos cue"
```

---

## Task 7: Client photo module `src/lib/admin-photos-client.ts`

**Files:**
- Create: `src/lib/admin-photos-client.ts`

**Interfaces:**
- Consumes: `renditionPlan`, `watermarkLayout`, `WHITE_OPACITY`, `SHADOW_OPACITY` (Task 1); the upload/reorder/delete endpoints (Tasks 3–4).
- Produces: `initPhotoManager(root: HTMLElement): void` — wires a photo panel whose DOM is: a `[data-grid]` container of `[data-id]` tiles (each with a `[data-del]` button and a draggable handle) and a `<input type="file" data-file>` + `[data-drop]` drop-zone + `[data-status]` line. `root.dataset.slug` holds the listing slug.

- [ ] **Step 1: Write the client module**

Create `src/lib/admin-photos-client.ts`:

```ts
import { renditionPlan, watermarkLayout, WHITE_OPACITY, SHADOW_OPACITY } from './admin-photos';

const ACCEPT = /^image\/(jpeg|png|webp)$/;

// Load the wordmark once as a white SVG image (mirrors _watermark.mjs loadWordmarkSvgs).
let whiteLogo: Promise<HTMLImageElement> | null = null;
function loadWhiteLogo(): Promise<HTMLImageElement> {
  if (whiteLogo) return whiteLogo;
  whiteLogo = fetch('/Rentoo.svg')
    .then((r) => r.text())
    .then((svg) => {
      const white = svg.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#ffffff"');
      const url = `data:image/svg+xml;utf8,${encodeURIComponent(white)}`;
      return loadImg(url);
    });
  return whiteLogo;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image load failed'));
    img.src = src;
  });
}

// Render one watermarked WebP rendition at the given width.
async function renderRendition(bitmap: ImageBitmap, targetW: number, quality: number, logo: HTMLImageElement): Promise<Blob> {
  const scale = targetW / bitmap.width;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const aspect = logo.naturalWidth / logo.naturalHeight;
  const box = watermarkLayout(w, h, aspect);
  ctx.save();
  ctx.globalAlpha = WHITE_OPACITY;
  ctx.shadowColor = `rgba(0,0,0,${SHADOW_OPACITY})`;
  ctx.shadowBlur = Math.max(2, Math.round(box.w / 90));
  ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, Math.round(box.w / 300));
  ctx.drawImage(logo, box.left, box.top, box.w, box.h);
  ctx.restore();

  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/webp', quality),
  );
}

async function processFile(file: File): Promise<{ form: FormData; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const logo = await loadWhiteLogo();
  const plan = renditionPlan(bitmap.width);
  const form = new FormData();
  let galleryDims = { w: bitmap.width, h: bitmap.height };
  for (const r of plan) {
    const blob = await renderRendition(bitmap, r.width, r.quality, logo);
    form.set(r.name, blob, `${r.name}.webp`);
    if (r.name === 'gallery') galleryDims = { w: Math.round(bitmap.width * (r.width / bitmap.width)), h: Math.round(bitmap.height * (r.width / bitmap.width)) };
  }
  bitmap.close();
  form.set('width', String(galleryDims.w));
  form.set('height', String(galleryDims.h));
  return { form, width: galleryDims.w, height: galleryDims.h };
}

export function initPhotoManager(root: HTMLElement): void {
  const slug = root.dataset.slug!;
  const grid = root.querySelector<HTMLElement>('[data-grid]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-file]')!;
  const dropZone = root.querySelector<HTMLElement>('[data-drop]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;

  const setStatus = (msg: string) => { status.textContent = msg; };
  const orderedIds = () => Array.from(grid.querySelectorAll<HTMLElement>('[data-id]')).map((el) => el.dataset.id!);
  const markCover = () => {
    grid.querySelectorAll<HTMLElement>('[data-id]').forEach((el, i) => el.classList.toggle('is-cover', i === 0));
  };

  async function postJson(path: string, body: unknown): Promise<boolean> {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  }

  function makeTile(id: string, cardUrl: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ph-tile';
    tile.dataset.id = id;
    tile.draggable = true;
    tile.innerHTML = `<img src="${cardUrl}" alt="" loading="lazy" /><span class="cover-badge">Cover</span><button type="button" class="del" data-del aria-label="Delete photo">×</button>`;
    return tile;
  }

  // ---- upload ----
  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      if (!ACCEPT.test(file.type)) { setStatus(`Skipped ${file.name}: ${/he/i.test(file.type) || /\.hei/i.test(file.name) ? 'HEIC not supported — export as JPEG first.' : 'unsupported type.'}`); continue; }
      try {
        setStatus(`Processing ${file.name}…`);
        const { form } = await processFile(file);
        setStatus(`Uploading ${file.name}…`);
        const res = await fetch(`/api/admin/photos/${slug}`, { method: 'POST', body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) { setStatus(`Failed ${file.name}: ${data?.error ?? res.status}`); continue; }
        grid.appendChild(makeTile(data.id, `/media/${data.r2_key}-card.webp`));
        markCover();
        setStatus(`Added ${file.name}.`);
      } catch (e) { setStatus(`Error on ${file.name}: ${(e as Error).message}`); }
    }
  }

  fileInput.addEventListener('change', () => { if (fileInput.files?.length) { uploadFiles(fileInput.files); fileInput.value = ''; } });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('over'); if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files); });

  // ---- delete (optimistic + revert) ----
  grid.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-del]');
    if (!btn) return;
    const tile = btn.closest<HTMLElement>('[data-id]')!;
    if (!confirm('Delete this photo?')) return;
    const id = tile.dataset.id!;
    const next = tile.nextElementSibling;
    tile.remove(); markCover();
    const ok = await postJson(`/api/admin/photos/${slug}/delete`, { id });
    if (!ok) { next ? grid.insertBefore(tile, next) : grid.appendChild(tile); markCover(); setStatus('Delete failed — restored.'); }
    else setStatus('Deleted.');
  });

  // ---- drag reorder (optimistic + revert) ----
  let dragEl: HTMLElement | null = null;
  grid.addEventListener('dragstart', (e) => { dragEl = (e.target as HTMLElement).closest('[data-id]'); dragEl?.classList.add('dragging'); });
  grid.addEventListener('dragend', () => { dragEl?.classList.remove('dragging'); dragEl = null; });
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!over || over === dragEl || !dragEl) return;
    const rect = over.getBoundingClientRect();
    const after = (e.clientX - rect.left) / rect.width > 0.5;
    grid.insertBefore(dragEl, after ? over.nextSibling : over);
  });
  grid.addEventListener('drop', async (e) => {
    e.preventDefault();
    markCover();
    const before = Array.from(grid.querySelectorAll<HTMLElement>('[data-id]'));
    const ids = before.map((el) => el.dataset.id!);
    const ok = await postJson(`/api/admin/photos/${slug}/reorder`, { ids });
    setStatus(ok ? 'Order saved.' : 'Reorder failed.');
  });

  markCover();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx astro check`
Expected: 0 errors. (If the DOM lib types are missing, they are provided by Astro's default `tsconfig`; no change needed.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin-photos-client.ts
git commit -m "feat(admin): browser photo manager (canvas watermark+encode, upload/reorder/delete)"
```

---

## Task 8: Editor rewrite `src/pages/admin/[slug].astro` (restyle + photo panel)

**Files:**
- Modify: `src/pages/admin/[slug].astro` (full rewrite; keep the POST save handler + data logic, drop the `cover` radio)

**Interfaces:**
- Consumes: `AdminLayout` (Task 5); `initPhotoManager` (Task 7); existing `getAnyListingBySlug`, `updateListingFields` (unchanged). `setCover` is no longer called from this page.

- [ ] **Step 1: Rewrite the editor**

Replace the entire contents of `src/pages/admin/[slug].astro` with:

```astro
---
export const prerender = false;
import AdminLayout from '../../layouts/AdminLayout.astro';
import { getAnyListingBySlug, updateListingFields } from '../../lib/db';
import { mediaUrl } from '../../lib/media';

const slug = Astro.params.slug!;
const db = Astro.locals.db;

if (Astro.request.method === 'POST') {
  const form = await Astro.request.formData();
  const clean = (k: string) => { const v = form.get(k); const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; };
  const statusIn = String(form.get('status') || 'available');
  const status = ['available', 'rented', 'on-hold'].includes(statusIn) ? statusIn : 'available';
  const furnIn = clean('furnishing');
  const furnishing = furnIn && ['furnished', 'semi-furnished', 'unfurnished'].includes(furnIn) ? furnIn : null;
  await updateListingFields(db, slug, {
    rent_inr: parseInt(String(form.get('rent_inr') || '0'), 10) || 0,
    status, furnishing,
    bhk_type: clean('bhk_type'),
    property_type: clean('property_type') || 'apartment',
    landmark: clean('landmark'),
    description: clean('description'),
    map_url: clean('map_url'),
    featured: form.get('featured') ? 1 : 0,
    published: form.get('published') ? 1 : 0,
  });
  return Astro.redirect(`/admin/${slug}?saved=1`);
}

const data = await getAnyListingBySlug(db, slug);
if (!data) return Astro.redirect('/admin', 303);
const { property, media, neighbourhood } = data;
const photos = media.filter((m) => m.kind === 'photo');
const saved = Astro.url.searchParams.get('saved') === '1';
const sel = (v: any, opt: string) => (v === opt ? 'selected' : undefined);
const email = Astro.locals.adminEmail;
---
<AdminLayout title={`Edit ${property.display_id} — Rentoo Admin`} email={email} back={true}>
  {saved && <div class="toast">✓ Saved.</div>}

  <h1 class="page-title">Edit {property.display_id}</h1>
  <p class="sub">{[property.bhk_type, property.property_type].filter(Boolean).join(' ')} · {neighbourhood?.name ?? property.neighbourhood_slug} · <code>{property.slug}</code></p>

  <form method="POST" class="card">
    <div class="row"><label for="rent_inr">Rent (₹/mo)</label><input type="number" id="rent_inr" name="rent_inr" value={property.rent_inr} min="0" /></div>
    <div class="row"><label for="status">Status</label>
      <div>
        <select id="status" name="status">
          <option value="available" selected={sel(property.status,'available')}>Available</option>
          <option value="rented" selected={sel(property.status,'rented')}>Rented out (hidden from site)</option>
          <option value="on-hold" selected={sel(property.status,'on-hold')}>On hold</option>
        </select>
        <p class="hint">Rented-out listings are hidden from the public site.</p>
      </div>
    </div>
    <div class="row"><label for="property_type">Type</label><input type="text" id="property_type" name="property_type" value={property.property_type} /></div>
    <div class="row"><label for="bhk_type">BHK</label><input type="text" id="bhk_type" name="bhk_type" value={property.bhk_type ?? ''} placeholder="e.g. 2BHK (residential only)" /></div>
    <div class="row"><label for="furnishing">Furnishing</label>
      <select id="furnishing" name="furnishing">
        <option value="" selected={!property.furnishing}>—</option>
        <option value="furnished" selected={sel(property.furnishing,'furnished')}>Furnished</option>
        <option value="semi-furnished" selected={sel(property.furnishing,'semi-furnished')}>Semi-furnished</option>
        <option value="unfurnished" selected={sel(property.furnishing,'unfurnished')}>Unfurnished</option>
      </select>
    </div>
    <div class="row"><label for="landmark">Landmark</label><input type="text" id="landmark" name="landmark" value={property.landmark ?? ''} /></div>
    <div class="row"><label for="description">Description</label><textarea id="description" name="description">{property.description ?? ''}</textarea></div>
    <div class="row"><label for="map_url">Map URL</label>
      <div>
        <input type="text" id="map_url" name="map_url" value={property.map_url ?? ''} placeholder="Google Maps 'Embed a map' src, or blank for area map" />
        <p class="hint">Paste the <code>src</code> from Google Maps → Share → <b>Embed a map</b>. Blank = auto area map.</p>
      </div>
    </div>
    <div class="row"><label>Flags</label>
      <div class="checks">
        <label class="chk"><input type="checkbox" name="featured" checked={property.featured === 1} /> Featured</label>
        <label class="chk"><input type="checkbox" name="published" checked={property.published === 1} /> Published</label>
      </div>
    </div>
    <div class="actions"><button type="submit" class="btn-sheen">Save changes</button><span class="hint">Changes go live immediately.</span></div>
  </form>

  <section class="card photos-card" data-photos data-slug={property.slug}>
    <h2 class="section-title">Photos</h2>
    <p class="hint">Drag to reorder. The first photo is the <b>cover</b>. JPEG/PNG/WebP — iPhone HEIC must be exported as JPEG first.</p>
    <div class="ph-grid" data-grid>
      {photos.map((m) => (
        <div class="ph-tile" data-id={m.id} draggable="true">
          <img src={mediaUrl(m.r2_key, 'card')} alt="" loading="lazy" />
          <span class="cover-badge">Cover</span>
          <button type="button" class="del" data-del aria-label="Delete photo">×</button>
        </div>
      ))}
    </div>
    <label class="drop" data-drop>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-file hidden />
      <span>Drop photos here or <b>click to choose</b></span>
    </label>
    <p class="status" data-status aria-live="polite"></p>
  </section>

  <style>
    .toast { background: var(--ok-mist); color: var(--ok-green); padding: 10px 14px; border-radius: var(--r-md); margin-bottom: var(--space-lg); font-size: .9rem; font-weight: 600; }
    .page-title { font-family: var(--font-display); font-size: 1.5rem; margin: 0 0 var(--space-xs); }
    .sub { color: var(--ink-muted); font-size: .85rem; margin: 0 0 var(--space-lg); }
    .card { background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--r-lg); box-shadow: var(--elev-1); padding: var(--space-xl); margin-bottom: var(--space-xl); }
    .row { display: grid; grid-template-columns: 150px 1fr; gap: var(--space-lg); align-items: start; padding: 11px 0; border-bottom: 1px solid var(--color-border); }
    .row:last-of-type { border-bottom: none; }
    label { font-family: var(--font-display); font-weight: 600; font-size: .85rem; padding-top: 8px; }
    input[type=text], input[type=number], select, textarea { width: 100%; padding: 9px 11px; border: 1px solid var(--color-border); background: var(--color-input); border-radius: var(--r-sm); font-size: .9rem; font-family: inherit; color: var(--color-foreground); }
    textarea { min-height: 84px; resize: vertical; }
    .hint { font-size: .75rem; color: var(--ink-muted); margin: 4px 0 0; }
    .checks { display: flex; gap: var(--space-xl); }
    .chk { display: flex; align-items: center; gap: 7px; font-weight: 500; font-family: var(--font-sans); padding: 0; }
    .actions { margin-top: var(--space-lg); display: flex; gap: var(--space-lg); align-items: center; }
    button[type=submit] { background: var(--color-primary); color: var(--color-primary-foreground); border: none; padding: 11px 24px; border-radius: var(--r-md); font-size: .9rem; font-weight: 600; font-family: var(--font-display); cursor: pointer; }
    .section-title { font-family: var(--font-display); font-size: 1.1rem; margin: 0 0 var(--space-xs); }
    .ph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--space-md); margin: var(--space-md) 0; }
    .ph-tile { position: relative; border: 2px solid var(--color-border); border-radius: var(--r-md); overflow: hidden; cursor: grab; background: var(--color-surface-alt); }
    .ph-tile img { width: 100%; height: 96px; object-fit: cover; display: block; }
    .ph-tile.dragging { opacity: .4; }
    .cover-badge { display: none; position: absolute; top: 6px; left: 6px; background: var(--color-secondary); color: #fff; font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px; border-radius: 99px; }
    .ph-tile.is-cover { border-color: var(--color-secondary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-secondary) 30%, transparent); }
    .ph-tile.is-cover .cover-badge { display: block; }
    .del { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border: none; border-radius: 50%; background: rgba(15,23,42,.72); color: #fff; font-size: 15px; line-height: 1; cursor: pointer; }
    .del:hover { background: var(--danger-red); }
    .drop { display: block; text-align: center; padding: var(--space-xl); border: 2px dashed var(--color-border); border-radius: var(--r-md); color: var(--ink-muted); font-size: .9rem; cursor: pointer; }
    .drop.over { border-color: var(--focus-clay); color: var(--color-foreground); }
    .status { font-size: .8rem; color: var(--ink-muted); margin-top: var(--space-sm); min-height: 1em; }
  </style>

  <script>
    import { initPhotoManager } from '../../lib/admin-photos-client';
    const root = document.querySelector<HTMLElement>('[data-photos]');
    if (root) initPhotoManager(root);
  </script>
</AdminLayout>
```

- [ ] **Step 2: Typecheck + build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/[slug].astro
git commit -m "polish(admin): editor onto site tokens + drag-reorder photo panel (drops radio cover)"
```

---

## Task 9: End-to-end verification on the real worker

**Files:** none (verification + fixes only)

- [ ] **Step 1: Full test suite + typecheck + build**

Run: `npm test && npx astro check && npm run build`
Expected: all tests pass, 0 type errors, build succeeds.

- [ ] **Step 2: Run the real worker locally (middleware active)**

Run: `npx wrangler dev -c dist/server/wrangler.json`
Note: `/admin` requires a valid Access JWT. To exercise the photo flow locally without Access, temporarily hit it via the deployed site after Step 4, OR confirm the middleware 403s unauthenticated (fail-closed) here, then do the interactive photo checks on the live deploy.

- [ ] **Step 3: Watermark parity check**

Generate a reference from the offline pipeline and compare visually to a client-rendered rendition:
Run: `node scripts/watermark-upload.mjs --sample`
Open `seed/_preview/*-gallery.webp` and compare the wordmark (position, size ~0.6× width, faint white + soft shadow) against a photo uploaded through the admin panel. They should read the same. If the client mark is too strong/weak, adjust only the `ctx.shadowBlur`/offset in `admin-photos-client.ts` (opacities already match the constants).

- [ ] **Step 4: Deploy + live interactive check**

Run: `npx wrangler deploy`
Then on `https://rentoo.in/admin/<a-listing>` (signed in): upload 2–3 JPEGs (watch per-file status), confirm they appear watermarked; drag to reorder and reload to confirm the order persisted; verify the first tile shows the **Cover** badge and the public card uses it; delete one and reload to confirm it's gone; confirm the listing's public gallery reflects the changes. Confirm an HEIC file is rejected with the export-JPEG message.

- [ ] **Step 5: Final commit (if any tweaks were made)**

```bash
git add -A
git commit -m "chore(admin): phase-2 photo mgmt verified end-to-end on live worker"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 upload (Tasks 1,3,7,8), delete (Tasks 2,4,7,8), reorder (Tasks 2,4,7,8), unified cover = index 0 (Task 1 `normalizePhotoOrder` + Task 8 badge), opaque `r2_key` (Task 1 `photoBaseKey` + Task 3), soft delete (Task 2 `deletePhoto`), HEIC reject (Task 7), client-side engine (Task 7), R2 via binding (Task 3). Part 2 `AdminLayout` (Task 5), list restyle + needs-photos cue (Task 6), editor restyle + drop radio (Task 8), themed photo panel (Task 8). Testing (Task 1 unit + Task 9 e2e/parity). All covered.
- **Type consistency:** `normalizePhotoOrder`, `renditionPlan`, `watermarkLayout`, `photoBaseKey`, `randomPhotoToken`, `RENDITIONS` names match across Tasks 1/2/3/7. `addPhoto` returns `PropertyMedia | null`; endpoint reads `.id/.r2_key/.display_order`. Client DOM contract (`[data-photos][data-slug]`, `[data-grid]`, `[data-id]`, `[data-del]`, `[data-file]`, `[data-drop]`, `[data-status]`) matches between Task 7 (`initPhotoManager`) and Task 8 markup.
- **No migration** — confirmed schema already sufficient.
