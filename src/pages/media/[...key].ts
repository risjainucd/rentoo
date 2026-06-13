import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAllowedReferer } from '../../lib/media';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key; // e.g. "properties/<slug>/0-card.webp"
  if (!key) return new Response('Not found', { status: 404 });
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response('Forbidden', { status: 403 });

  const obj = await (env as unknown as Env).MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
    },
  });
};
