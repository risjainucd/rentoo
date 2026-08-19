import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAllowedReferer } from '../../lib/media';
import { parseRange } from '../../lib/range';

export const prerender = false;

function contentTypeFor(key: string, fallback: string): string {
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.webp')) return 'image/webp';
  return fallback;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

// Only the two methods this route needs. Spelled out locally because both lib.dom's
// CacheStorage (which has no `default`) and @cloudflare/workers-types' declare the `caches`
// global, and which declaration wins under skipLibCheck is not something to depend on.
type EdgeCache = {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
};

// `caches.default` exists only in the Workers runtime — it is absent in the vitest node
// environment and under `astro dev`, so it has to be feature-detected, not assumed.
function edgeCache(): EdgeCache | undefined {
  if (typeof caches === 'undefined') return undefined;
  return (caches as unknown as { default?: EdgeCache }).default;
}

// Hand the cache a clone and stream the original back immediately: Response.body is a
// one-shot stream, so whichever copy the cache swallows must not be the one we return.
// waitUntil keeps the write alive past the response; where no ExecutionContext is reachable
// the put still has to run unawaited, and a rejection on a floating promise would otherwise
// surface as an unhandled rejection.
function cacheInBackground(
  cache: EdgeCache,
  url: string,
  res: Response,
  ctx: ExecutionContext | undefined,
): void {
  const write = cache.put(url, res.clone());
  if (ctx) ctx.waitUntil(write);
  else void write.catch(() => {});
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key; // "properties/<slug>/0-card.webp" or "properties/<slug>/tour.mp4"
  if (!key) return new Response('Not found', { status: 404 });
  // The hotlink guard must clear before any cache lookup. The cache key is the URL alone, so
  // checking the cache first would serve a hotlinker the bytes and leave this check dead.
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response('Forbidden', { status: 403 });

  const bucket = (env as unknown as Env).MEDIA;
  const rangeHeader = request.headers.get('range');

  // Hot path: no Range header (every poster/image GET). One get(), no extra head().
  if (!rangeHeader) {
    // A body read from the R2 binding is never a fetch() subrequest, so Cloudflare's cache
    // never sees it (no cf-cache-status, ~400ms TTFB on a repeat view). Fronting just this
    // path with the Cache API turns a repeat view into an edge hit instead of a Worker
    // invocation plus an R2 class-B read. Only the plain 200 is eligible: a 206 cannot be
    // stored safely (its truncated body could be replayed as a whole object) and 403/404/416
    // must never be replayed at all.
    const cache = edgeCache();
    const hit = await cache?.match(request.url);
    if (hit) return hit;

    const obj = await bucket.get(key);
    if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Content-Type', contentTypeFor(key, 'image/webp'));
    headers.set('Cache-Control', IMMUTABLE);
    headers.set('ETag', obj.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(obj.size));
    const res = new Response(obj.body, { status: 200, headers });
    if (cache) cacheInBackground(cache, request.url, res, locals.cfContext);
    return res;
  }

  // Range present: head() to size the range, then a ranged get() (video seeking / iOS).
  const head = await bucket.head(key);
  if (!head) return new Response('Not found', { status: 404 });

  const size = head.size;
  const parsed = parseRange(rangeHeader, size);

  const baseHeaders = new Headers();
  head.writeHttpMetadata(baseHeaders);
  baseHeaders.set('Content-Type', contentTypeFor(key, 'image/webp'));
  baseHeaders.set('ETag', head.httpEtag);
  baseHeaders.set('Accept-Ranges', 'bytes');

  // Unsatisfiable range -> 416 with total size, no body. Never cache an error response.
  if (parsed.type === 'unsatisfiable') {
    const headers = new Headers(baseHeaders);
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Cache-Control', 'no-store');
    headers.delete('Content-Type');
    return new Response(null, { status: 416, headers });
  }

  // Malformed Range parses to 'full' -> serve the whole body as 200 (RFC: ignore bad Range).
  if (parsed.type === 'full') {
    const obj = await bucket.get(key);
    if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });
    const headers = new Headers(baseHeaders);
    headers.set('Cache-Control', IMMUTABLE);
    headers.set('Content-Length', String(size));
    return new Response(obj.body, { status: 200, headers });
  }

  // Satisfiable range -> 206 Partial Content. parseRange already clamped to [0, size-1];
  // we still read back obj.range in case R2 returns fewer bytes than requested.
  const { offset, length } = parsed;
  const obj = await bucket.get(key, { range: { offset, length } });
  if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });

  const served = obj.range ?? { offset, length };
  const servedOffset = 'offset' in served && served.offset != null ? served.offset : offset;
  const servedLength = 'length' in served && served.length != null ? served.length : length;
  const end = servedOffset + servedLength - 1;

  const headers = new Headers(baseHeaders);
  // Partial bodies must not be marked immutable (could be replayed as a truncated full response).
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Content-Range', `bytes ${servedOffset}-${end}/${size}`);
  headers.set('Content-Length', String(servedLength));
  return new Response(obj.body, { status: 206, headers });
};

export const HEAD: APIRoute = async ({ params, request, locals }) => {
  const key = params.key;
  if (!key) return new Response(null, { status: 404 });
  if (!isAllowedReferer(request.headers.get('referer'), locals.siteOrigin))
    return new Response(null, { status: 403 });

  const head = await (env as unknown as Env).MEDIA.head(key);
  if (!head) return new Response(null, { status: 404 });

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('Content-Type', contentTypeFor(key, 'image/webp'));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', head.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(head.size));
  return new Response(null, { status: 200, headers });
};
