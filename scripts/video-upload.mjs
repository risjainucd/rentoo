// Transcode every listing walkthrough, watermark it, upload tour.mp4 + poster WebPs to R2,
// then emit seed/video-media.sql.
//
//   node scripts/video-upload.mjs --sample          # local previews for a few listings, no upload
//   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node scripts/video-upload.mjs                  # full run: transcode + upload + seed/video-media.sql
//
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';

// ---- config ----
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'b572ad0da703afe2e58898eef8444b59';
const BUCKET = 'rentoo-photos';
const INVENTORY = 'inventory 2026';
const LOGO = 'Rentoo.svg';
const SAMPLE = process.argv.includes('--sample');
const SAMPLE_LIMIT = 3;

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const CAP = 1280;
const CONCURRENCY = 2;
const VIDEO_RE = /\.mp4$/i;
const IMG_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

const SIZES = [
  { name: 'card', width: 600, quality: 72 },
  { name: 'gallery', width: 1200, quality: 80 },
  { name: 'full', width: 2000, quality: 82 },
];

// Resolved by metadata probe (longest clip <= ~120s) + eyeball. Only #01/#37 need overriding.
const CLIP_OVERRIDE = {
  '#01': 'WhatsApp Video 2026-04-07 at 12.45.06 PM.mp4',
  '#37': 'WhatsApp Video 2026-04-08 at 8.07.20 PM.mp4',
};

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

// ---- watermark ----
const { svgWhite, svgBlack } = loadWordmarkSvgs(LOGO);
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);

// ---- ffmpeg helpers ----
function run(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 400)}`))));
  });
}
function runBuf(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args);
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 400)}`))));
  });
}
const probe1 = (src, ent) =>
  run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', ent, '-of', 'csv=p=0', src])
    // ffprobe csv=p=0 can emit a trailing comma on some containers ("640,"); take the leading
    // signed integer token so width/height/rotation never parse to NaN. Empty -> '' -> 0 downstream.
    .then((s) => { const m = s.match(/-?\d+/); return m ? m[0] : ''; });

async function outputDims(src) {
  const cw = +(await probe1(src, 'stream=width'));
  const ch = +(await probe1(src, 'stream=height'));
  const rot = Math.abs(+(await probe1(src, 'stream_side_data=rotation')) || 0) % 180;
  let dw = cw, dh = ch;
  if (rot === 90) { dw = ch; dh = cw; }                 // displayed dims
  const long = Math.max(dw, dh), s = long > CAP ? CAP / long : 1;
  return { ow: Math.round((dw * s) / 2) * 2, oh: Math.round((dh * s) / 2) * 2 };
}

async function transcode(src, wmPng, ow, oh, outMp4) {
  await run(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', src, '-i', wmPng,
    '-filter_complex',
      `[0:v]scale=${ow}:${oh}:flags=lanczos,format=yuv420p[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k',
    '-map_metadata', '-1', '-map_chapters', '-1',
    outMp4,
  ]);
}

// Poster: representative frame ~1s in (skips black first frame), upright via default autorotate.
function posterPng(src) {
  return runBuf(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-ss', '00:00:01', '-i', src, '-frames:v', '1', '-q:v', '2', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
}

// Poster PNG -> 3 watermarked WebP renditions (same look as photos).
async function renderPosterSizes(posterBuf) {
  const base = sharp(posterBuf).rotate();
  const out = {};
  for (const s of SIZES) {
    const resized = await base.clone().resize({ width: s.width, withoutEnlargement: true }).toBuffer();
    const meta = await sharp(resized).metadata();
    let wm = await watermarkFor(meta.width);
    const wmMeta = await sharp(wm).metadata();
    if (wmMeta.width > meta.width || wmMeta.height > meta.height) {
      wm = await sharp(wm).resize({ width: Math.round(meta.width * 0.92), height: Math.round(meta.height * 0.92), fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    }
    out[s.name] = await sharp(resized).composite([{ input: wm, gravity: 'center' }]).webp({ quality: s.quality }).toBuffer();
  }
  return out;
}

async function upload(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

// ---- simple promise pool ----
async function pool(items, n, worker) {
  let i = 0, done = 0; const total = items.length;
  async function runOne() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); }
      catch (e) { console.error('  ! failed:', items[idx]?.folder, e.message); }
      done++;
      process.stdout.write(`\r  processed ${done}/${total} videos…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runOne));
  process.stdout.write('\n');
}

// ---- build work list ----
const photos = JSON.parse(readFileSync('seed/photos.json', 'utf8'));
const slugByDisplay = new Map(photos.map((p) => [p.display_id, p.slug]));

const folders = readdirSync(INVENTORY, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('#'))
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const work = [];
const skipped = [];
for (const folder of folders) {
  const slug = slugByDisplay.get(folder);
  if (!slug) { skipped.push(`${folder} (no live listing)`); continue; }
  const dir = join(INVENTORY, folder);
  const mp4s = readdirSync(dir).filter((f) => VIDEO_RE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!mp4s.length) { continue; }                       // photo-only listing -> media.sql owns it
  const pick = CLIP_OVERRIDE[folder] && mp4s.includes(CLIP_OVERRIDE[folder]) ? CLIP_OVERRIDE[folder] : mp4s[0];
  const hasPhotos = readdirSync(dir).some((f) => IMG_RE.test(f));
  work.push({ folder, slug, src: join(dir, pick), isCover: !hasPhotos });
}

console.log(`folders: ${folders.length} | videos to process: ${work.length}`);
if (skipped.length) console.log(`skipped ${skipped.length}:`, skipped.slice(0, 8).join('; '), skipped.length > 8 ? '…' : '');

mkdirSync('seed/_preview', { recursive: true });
const tmpDir = 'seed/_preview';

// ---- process one listing ----
const rows = new Map();
async function processOne(w) {
  const { ow, oh } = await outputDims(w.src);
  const wm = await watermarkFor(ow);
  const wmPng = join(tmpDir, `wm-${w.slug}.png`);
  writeFileSync(wmPng, wm);

  const outMp4 = join(tmpDir, `${w.slug}-tour.mp4`);
  await transcode(w.src, wmPng, ow, oh, outMp4);
  const poster = await renderPosterSizes(await posterPng(w.src));

  if (SAMPLE) {
    writeFileSync(join(tmpDir, `${w.slug}-tour-gallery.webp`), poster.gallery);
    console.log(`  preview -> ${outMp4} (+ poster) [${ow}x${oh}]`);
    return;
  }

  const mp4Buf = readFileSync(outMp4);
  await upload(`properties/${w.slug}/tour.mp4`, mp4Buf, 'video/mp4');
  for (const s of SIZES) await upload(`properties/${w.slug}/tour-${s.name}.webp`, poster[s.name], 'image/webp');
  rows.set(w.slug, { uuid: randomUUID(), w: ow, h: oh, isCover: w.isCover });
}

// ---- run ----
const list = SAMPLE ? work.slice(0, SAMPLE_LIMIT) : work;
await pool(list, CONCURRENCY, processOne);

if (SAMPLE) {
  console.log(`\nWrote ${list.length} previews to ${tmpDir}/. Open the *-tour.mp4 to check orientation + watermark, then re-run without --sample.`);
  process.exit(0);
}

// ---- emit seed/video-media.sql ----
let sql = '-- generated by scripts/video-upload.mjs — property_media rows for uploaded tour videos\n';
let n = 0;
for (const [slug, r] of rows) {
  sql += `DELETE FROM property_media WHERE kind='video' AND property_id = (SELECT id FROM properties WHERE slug='${slug}');\n`;
  sql += `INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked) `
    + `SELECT '${r.uuid}', id, 'video', 'properties/${slug}/tour', -1, ${r.isCover ? 1 : 0}, ${r.w}, ${r.h}, 1 `
    + `FROM properties WHERE slug='${slug}';\n`;
  n++;
}
mkdirSync('seed', { recursive: true });
writeFileSync('seed/video-media.sql', sql);
console.log(`\nDone. Uploaded ${rows.size} tours. Wrote ${n} video rows to seed/video-media.sql.`);
console.log('Next: npx wrangler d1 execute rentoo-listings --remote --file=seed/video-media.sql');
