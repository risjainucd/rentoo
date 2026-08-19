import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import type { APIContext } from 'astro';
import { mediaUrl, isAllowedReferer, videoUrl } from '../src/lib/media';

// The route reaches for the Workers-only `cloudflare:workers` env import, which vitest's node
// environment cannot resolve. Hoisted so the mock factory can close over the fake bucket.
const { bucket } = vi.hoisted(() => ({ bucket: { get: vi.fn(), head: vi.fn() } }));
vi.mock('cloudflare:workers', () => ({ env: { MEDIA: bucket } }));
const { GET } = await import('../src/pages/media/[...key]');

describe('mediaUrl', () => {
  test('appends size + webp to base key', () => {
    expect(mediaUrl('properties/2bhk-gulab-garh-01/0', 'card')).toBe('/media/properties/2bhk-gulab-garh-01/0-card.webp');
  });
});
describe('isAllowedReferer', () => {
  const origin = 'https://rentoo.pages.dev';
  test('allows same-origin', () => expect(isAllowedReferer('https://rentoo.pages.dev/rent', origin)).toBe(true));
  test('allows empty referer', () => expect(isAllowedReferer(null, origin)).toBe(true));
  test('blocks foreign origin', () => expect(isAllowedReferer('https://evil.example/x', origin)).toBe(false));
});
describe('videoUrl', () => {
  test('appends .mp4 to the base key', () => {
    expect(videoUrl('properties/3bhk-apartment-iskon-temple-03/tour'))
      .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour.mp4');
  });
  test('poster reuses mediaUrl on the same base key', () => {
    expect(mediaUrl('properties/3bhk-apartment-iskon-temple-03/tour', 'gallery'))
      .toBe('/media/properties/3bhk-apartment-iskon-temple-03/tour-gallery.webp');
  });
});

const ORIGIN = 'https://rentoo.pages.dev';
const KEY = 'properties/2bhk-gulab-garh-01/0-card.webp';
const MEDIA_URL = `${ORIGIN}/media/${KEY}`;
const BODY = 'webp-bytes';

/** Just enough of an R2ObjectBody for the route: metadata writer, etag, size, one-shot body. */
function r2Body(bytes = BODY, range?: { offset: number; length: number }) {
  return {
    body: new Response(bytes).body,
    size: BODY.length,
    httpEtag: '"etag-1"',
    range,
    writeHttpMetadata: (h: Headers) => h.set('Content-Type', 'image/webp'),
  };
}
function r2Head() {
  return {
    size: BODY.length,
    httpEtag: '"etag-1"',
    writeHttpMetadata: (h: Headers) => h.set('Content-Type', 'image/webp'),
  };
}

/** Stands in for `caches.default`, recording every put so tests can assert what was stored. */
function fakeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: vi.fn(async (url: string) => store.get(url)),
    put: vi.fn(async (url: string, res: Response) => { store.set(url, res); }),
  };
}

/** Minimal APIContext: the route reads only params.key, request, and locals. */
function ctx(opts: { headers?: Record<string, string>; waitUntil?: (p: Promise<unknown>) => void } = {}) {
  return {
    params: { key: KEY },
    request: new Request(MEDIA_URL, { headers: opts.headers }),
    locals: { siteOrigin: ORIGIN, cfContext: opts.waitUntil ? { waitUntil: opts.waitUntil } : undefined },
  } as unknown as APIContext;
}

describe('GET /media/[...key] edge cache', () => {
  let cache: ReturnType<typeof fakeCache>;
  let waited: Promise<unknown>[];
  const waitUntil = (p: Promise<unknown>) => { waited.push(p); };

  beforeEach(() => {
    bucket.get.mockReset();
    bucket.head.mockReset();
    cache = fakeCache();
    waited = [];
    vi.stubGlobal('caches', { default: cache });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('miss populates the cache and still returns a readable body', async () => {
    bucket.get.mockResolvedValue(r2Body());
    const res = await GET(ctx({ waitUntil }));

    expect(res.status).toBe(200);
    expect(cache.match).toHaveBeenCalledWith(MEDIA_URL);
    expect(bucket.get).toHaveBeenCalledWith(KEY);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0][0]).toBe(MEDIA_URL);
    // The write goes through waitUntil rather than blocking the response.
    expect(waited).toHaveLength(1);
    await Promise.all(waited);

    // The clone is what the cache swallowed, so the caller's copy is still unread.
    expect(await res.text()).toBe(BODY);
    expect(await cache.store.get(MEDIA_URL)!.text()).toBe(BODY);
  });

  test('the cached copy carries every header the origin path set', async () => {
    bucket.get.mockResolvedValue(r2Body());
    const res = await GET(ctx({ waitUntil }));
    await Promise.all(waited);

    for (const r of [res, cache.store.get(MEDIA_URL)!]) {
      expect(r.headers.get('Content-Type')).toBe('image/webp');
      expect(r.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(r.headers.get('ETag')).toBe('"etag-1"');
      expect(r.headers.get('Accept-Ranges')).toBe('bytes');
      expect(r.headers.get('Content-Length')).toBe(String(BODY.length));
    }
  });

  test('hit serves the stored response without touching R2', async () => {
    cache.store.set(MEDIA_URL, new Response('cached-bytes', { status: 200 }));
    const res = await GET(ctx({ waitUntil }));

    expect(await res.text()).toBe('cached-bytes');
    expect(bucket.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  // The cache key is URL-only, so a hit served ahead of the referer check would hand a
  // hotlinker the bytes. The guard has to win even when the URL is already cached.
  test('foreign referer gets 403 even with the URL already in the cache', async () => {
    cache.store.set(MEDIA_URL, new Response('cached-bytes', { status: 200 }));
    const res = await GET(ctx({ headers: { referer: 'https://evil.example/x' }, waitUntil }));

    expect(res.status).toBe(403);
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  // A 206 body is a fragment; stored under a URL-only key it could be replayed as a whole object.
  test('206 partial content is never written to the cache', async () => {
    bucket.head.mockResolvedValue(r2Head());
    bucket.get.mockResolvedValue(r2Body('we', { offset: 0, length: 2 }));
    const res = await GET(ctx({ headers: { range: 'bytes=0-1' }, waitUntil }));

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-1/${BODY.length}`);
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(waited).toHaveLength(0);
  });

  test('416 unsatisfiable range is never written to the cache', async () => {
    bucket.head.mockResolvedValue(r2Head());
    const res = await GET(ctx({ headers: { range: `bytes=${BODY.length}-` }, waitUntil }));

    expect(res.status).toBe(416);
    expect(cache.put).not.toHaveBeenCalled();
  });

  test('404 for a missing object is never written to the cache', async () => {
    bucket.get.mockResolvedValue(null);
    const res = await GET(ctx({ waitUntil }));

    expect(res.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
  });

  // `astro dev` and vitest have no ExecutionContext; the put must still happen, unawaited.
  test('writes without an ExecutionContext instead of throwing', async () => {
    bucket.get.mockResolvedValue(r2Body());
    const res = await GET(ctx());

    expect(res.status).toBe(200);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  test('serves normally when caches.default is absent', async () => {
    vi.unstubAllGlobals();
    bucket.get.mockResolvedValue(r2Body());
    const res = await GET(ctx({ waitUntil }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
  });
});
