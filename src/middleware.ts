import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { verifyAccessJwt } from './lib/admin-auth';

function isProtected(path: string): boolean {
  return /^\/admin(\/|$)/.test(path) || /^\/api\/admin(\/|$)/.test(path);
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const e = env as unknown as Env;
  ctx.locals.db = e.DB;
  ctx.locals.siteOrigin = new URL(ctx.request.url).origin;

  if (isProtected(new URL(ctx.request.url).pathname)) {
    // Fail closed: no config or no valid Access JWT → 403. /admin is never
    // publicly editable, even before Cloudflare Access is wired up.
    const teamDomain = e.ACCESS_TEAM_DOMAIN;
    const aud = e.ACCESS_AUD;
    if (!teamDomain || !aud) {
      return new Response('Admin not configured', { status: 403 });
    }
    const token =
      ctx.request.headers.get('Cf-Access-Jwt-Assertion') ||
      (ctx.request.headers.get('Cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? '');
    const claims = token ? await verifyAccessJwt(token, teamDomain, aud) : null;
    if (!claims) return new Response('Forbidden', { status: 403 });

    const allow = (e.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && (!claims.email || !allow.includes(claims.email.toLowerCase()))) {
      return new Response('Forbidden', { status: 403 });
    }
    ctx.locals.adminEmail = claims.email ?? null;
  }

  return next();
});
