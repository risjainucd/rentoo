import type { APIRoute } from 'astro';

export const prerender = false;

// Increment a listing's view count. Fired once per session from the detail page
// (client guards with sessionStorage to avoid re-counting refreshes).
export const POST: APIRoute = async ({ params, locals }) => {
  const slug = params.slug;
  if (!slug) return new Response('Bad request', { status: 400 });

  const db = (locals as App.Locals).db;
  await db
    .prepare('UPDATE properties SET views = views + 1 WHERE slug = ? AND published = 1')
    .bind(slug)
    .run();

  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
