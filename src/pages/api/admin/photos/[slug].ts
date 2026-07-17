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
