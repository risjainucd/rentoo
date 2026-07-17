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
