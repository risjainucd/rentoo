import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.db = (env as unknown as Env).DB;
  ctx.locals.siteOrigin = new URL(ctx.request.url).origin;
  return next();
});
