/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
type Runtime = import('@astrojs/cloudflare').Runtime;
interface Env { DB: D1Database; MEDIA: R2Bucket; }
declare namespace App {
  interface Locals extends Runtime {
    db: D1Database;
    siteOrigin: string;
  }
}
