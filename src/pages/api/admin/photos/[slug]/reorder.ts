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
