// Watermark every local listing photo and upload WebP renditions to R2, then emit seed/media.sql.
//
// Maps `inventory 2026/#NN` folders -> slug via seed/photos.json (display_id -> slug),
// stamps a centered faint white "Rentoo" wordmark (with a soft shadow so it reads on light + dark),
// renders card/gallery/full WebP sizes, uploads to R2 bucket `rentoo-photos` over the S3 API,
// and writes seed/media.sql (DELETE+INSERT property_media rows, idempotent per listing).
//
//   npm i              # ensures sharp + @aws-sdk/client-s3 are present (already devDeps)
//   node scripts/watermark-upload.mjs --sample            # write a few local previews, no upload
//   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node scripts/watermark-upload.mjs                   # full run: watermark + upload + seed/media.sql
//
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';

// ---- config ----
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'b572ad0da703afe2e58898eef8444b59';
const BUCKET = 'rentoo-photos';
const INVENTORY = 'inventory 2026';
const LOGO = 'Rentoo.svg';
const SAMPLE = process.argv.includes('--sample');
const SAMPLE_SLUGS_LIMIT = 4;

const SIZES = [
  { name: 'card', width: 600, quality: 72 },
  { name: 'gallery', width: 1200, quality: 80 },
  { name: 'full', width: 2000, quality: 82 },
];
const IMG_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
const CONCURRENCY = 8;

// ---- s3 / r2 ----
const AK = process.env.R2_ACCESS_KEY_ID;
const SK = process.env.R2_SECRET_ACCESS_KEY;
let s3 = null;
if (!SAMPLE) {
  if (!AK || !SK) {
    console.error('Missing R2 credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or run with --sample).');
    process.exit(1);
  }
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: AK, secretAccessKey: SK },
  });
}

// ---- watermark builders ----
const { svgWhite, svgBlack } = loadWordmarkSvgs(LOGO);
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);

// ---- image -> renditions ----
async function renderSizes(srcPath) {
  const base = sharp(srcPath, { failOn: 'none' }).rotate(); // auto-orient from EXIF
  const out = {};
  let dims = null;
  for (const s of SIZES) {
    const resized = await base.clone().resize({ width: s.width, withoutEnlargement: true }).toBuffer();
    const meta = await sharp(resized).metadata();
    let wm = await watermarkFor(meta.width);
    // Clamp watermark within the photo (wide/short panoramas can make the wordmark taller than the image).
    const wmMeta = await sharp(wm).metadata();
    if (wmMeta.width > meta.width || wmMeta.height > meta.height) {
      wm = await sharp(wm).resize({ width: Math.round(meta.width * 0.92), height: Math.round(meta.height * 0.92), fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    }
    const buf = await sharp(resized).composite([{ input: wm, gravity: 'center' }]).webp({ quality: s.quality }).toBuffer();
    out[s.name] = buf;
    if (s.name === 'gallery') dims = { w: meta.width, h: meta.height };
  }
  if (!dims) { const m = await sharp(out.full).metadata(); dims = { w: m.width, h: m.height }; }
  return { out, dims };
}

async function upload(key, body) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/webp' }));
}

// ---- simple promise pool ----
async function pool(items, n, worker) {
  let i = 0, done = 0;
  const total = items.length;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); }
      catch (e) { console.error('  ! item failed:', items[idx]?.src, e.message); }
      done++;
      if (done % 25 === 0 || done === total) process.stdout.write(`\r  uploaded ${done}/${total} photos…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  process.stdout.write('\n');
}

// ---- main ----
const photos = JSON.parse(readFileSync('seed/photos.json', 'utf8'));
const slugByDisplay = new Map(photos.map((p) => [p.display_id, p.slug]));

const folders = readdirSync(INVENTORY, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('#'))
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// Build flat work list: one entry per photo.
const work = [];
const perSlug = new Map();
const skipped = [];
for (const folder of folders) {
  const slug = slugByDisplay.get(folder);
  if (!slug) { skipped.push(`${folder} (no live listing in photos.json)`); continue; }
  const files = readdirSync(join(INVENTORY, folder))
    .filter((f) => IMG_RE.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) { skipped.push(`${folder} -> ${slug} (no photos, video-only?)`); continue; }
  perSlug.set(slug, []);
  files.forEach((f, idx) => work.push({ folder, slug, idx, src: join(INVENTORY, folder, f), isCover: idx === 0 }));
}

console.log(`folders: ${folders.length} | listings with photos: ${perSlug.size} | photos: ${work.length}`);
if (skipped.length) console.log(`skipped ${skipped.length}:`, skipped.slice(0, 12).join('; '), skipped.length > 12 ? '…' : '');

if (SAMPLE) {
  mkdirSync('seed/_preview', { recursive: true });
  const sampleSlugs = [...perSlug.keys()].slice(0, SAMPLE_SLUGS_LIMIT);
  const picks = work.filter((w) => sampleSlugs.includes(w.slug) && w.isCover);
  for (const w of picks) {
    const { out } = await renderSizes(w.src);
    const dest = `seed/_preview/${w.slug}-0-gallery.webp`;
    writeFileSync(dest, out.gallery);
    console.log('  preview ->', dest);
  }
  console.log(`\nWrote ${picks.length} previews to seed/_preview/. Open them to check the watermark, then re-run without --sample.`);
  process.exit(0);
}

// Full run: watermark + upload, capturing dims per photo.
await pool(work, CONCURRENCY, async (w) => {
  const { out, dims } = await renderSizes(w.src);
  for (const s of SIZES) await upload(`properties/${w.slug}/${w.idx}-${s.name}.webp`, out[s.name]);
  perSlug.get(w.slug)[w.idx] = { uuid: randomUUID(), idx: w.idx, w: dims.w, h: dims.h, isCover: w.isCover };
});

// ---- emit seed/media.sql ----
let sql = '-- generated by scripts/watermark-upload.mjs — property_media rows for uploaded photos\n';
let rowCount = 0;
for (const [slug, rows] of perSlug) {
  const present = rows.filter(Boolean);
  if (!present.length) continue;
  sql += `DELETE FROM property_media WHERE kind='photo' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
  for (const r of present) {
    sql += `INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked) `
      + `SELECT '${r.uuid}', id, 'photo', 'properties/${slug}/${r.idx}', ${r.idx}, ${r.isCover ? 1 : 0}, ${r.w}, ${r.h}, 1 `
      + `FROM properties WHERE slug='${slug}';\n`;
    rowCount++;
  }
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/media.sql', sql);
console.log(`\nDone. Uploaded ${work.length} photos × ${SIZES.length} sizes. Wrote ${rowCount} media rows to seed/media.sql.`);
console.log('Next: npx wrangler d1 execute rentoo-listings --remote --file=seed/media.sql');
