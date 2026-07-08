import type { APIRoute } from 'astro';

export const prerender = false;

// Toggle a like on a listing. No auth — the client de-dupes per-device via
// localStorage; this endpoint just moves the aggregate counter. Body: {action}.
export const POST: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug;
  if (!slug) return new Response('Bad request', { status: 400 });

  let action = 'like';
  try {
    const body = await request.json() as { action?: string };
    if (body && (body.action === 'like' || body.action === 'unlike')) action = body.action;
  } catch { /* default to like */ }

  const db = (locals as App.Locals).db;
  const delta = action === 'unlike' ? -1 : 1;
  await db
    .prepare('UPDATE properties SET likes = MAX(0, likes + ?) WHERE slug = ? AND published = 1')
    .bind(delta, slug)
    .run();
  const row = await db.prepare('SELECT likes FROM properties WHERE slug = ?').bind(slug).first<{ likes: number }>();

  return new Response(JSON.stringify({ likes: row?.likes ?? 0 }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
