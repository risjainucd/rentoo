/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
type Runtime = import('@astrojs/cloudflare').Runtime;
interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  // Cloudflare Access (admin auth). Unset → /admin fails closed (403).
  ACCESS_TEAM_DOMAIN?: string; // e.g. rentoo.cloudflareaccess.com
  ACCESS_AUD?: string;         // Access application AUD tag
  ADMIN_EMAILS?: string;       // comma-separated allowlist
}
declare namespace App {
  interface Locals extends Runtime {
    db: D1Database;
    siteOrigin: string;
    adminEmail?: string | null;
  }
}
