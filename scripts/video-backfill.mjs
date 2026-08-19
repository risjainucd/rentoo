// Backfill tour videos for LIVE listings that have none, from a local copy of the Drive folder.
//
//   node scripts/video-backfill.mjs "/path/to/RENTOO"            # dry run
//   node scripts/video-backfill.mjs "/path/to/RENTOO" --apply    # transcode, upload, write D1
//
// The original scripts/video-upload.mjs only ever looked at "inventory 2026"; premium and
// commercial walkthroughs were never processed. This scans every section, and picks a clip by
// probing durations rather than taking the first filename alphabetically — 8 folders hold more
// than one video, which the two hand-written CLIP_OVERRIDE entries no longer cover.
//
// Scope guard: live listings with ZERO videos, so re-running never re-encodes or duplicates.
// R2 and D1 go through the authenticated wrangler session; no R2 access keys needed.
import { readdirSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';

// slice(2): argv[0] is the node binary and argv[1] this script — both look like paths.
const ROOT = process.argv.slice(2).find((a) => !a.startsWith('-'));
const APPLY = process.argv.includes('--apply');
if (!ROOT) { console.error('usage: node scripts/video-backfill.mjs "/path/to/RENTOO" [--apply]'); process.exit(1); }

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const BUCKET = 'rentoo-photos';
const DB = 'rentoo-listings';
const CAP = 1280;
const MAX_CLIP_S = 120;          // a tour longer than this is usually an unedited walk-around
const SIZES = [
  { name: 'card', width: 600, quality: 72 },
  { name: 'gallery', width: 1200, quality: 80 },
  { name: 'full', width: 2000, quality: 82 },
];

const { svgWhite, svgBlack } = loadWordmarkSvgs('public/Rentoo.svg');
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);

const wrangler = (args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function d1(sql) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
const run = (bin, args) => new Promise((res, rej) => {
  const p = spawn(bin, args); let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 300)}`))));
});
const runBuf = (bin, args) => new Promise((res, rej) => {
  const p = spawn(bin, args); const chunks = []; let err = '';
  p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (c) => (c === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`${bin} exited ${c}: ${err.slice(0, 300)}`))));
});
// ffprobe csv=p=0 can emit a trailing comma ("640,"); take the leading signed integer token.
const probe1 = (src, ent) => run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', ent, '-of', 'csv=p=0', src])
  .then((s) => { const m = s.match(/-?\d+/); return m ? m[0] : ''; });
const duration = (src) => run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])
  .then((s) => parseFloat(s) || 0).catch(() => 0);

async function outputDims(src) {
  const cw = +(await probe1(src, 'stream=width'));
  const ch = +(await probe1(src, 'stream=height'));
  const rot = Math.abs(+(await probe1(src, 'stream_side_data=rotation')) || 0) % 180;
  let dw = cw, dh = ch;
  if (rot === 90) { dw = ch; dh = cw; }                 // displayed dims
  const long = Math.max(dw, dh), s = long > CAP ? CAP / long : 1;
  return { ow: Math.round((dw * s) / 2) * 2, oh: Math.round((dh * s) / 2) * 2 };
}
const transcode = (src, wmPng, ow, oh, out) => run(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-i', wmPng,
  '-filter_complex', `[0:v]scale=${ow}:${oh}:flags=lanczos,format=yuv420p[base];[base][1:v]overlay=x=(W-w)/2:y=(H-h)/2[v]`,
  '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k', '-map_metadata', '-1', '-map_chapters', '-1', out,
]);
// Frame ~1s in skips a black first frame; input seek yields 0 bytes on sub-1s clips, so fall back.
async function posterPng(src) {
  let buf = await runBuf(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '00:00:01', '-i', src,
    '-frames:v', '1', '-q:v', '2', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
  if (!buf.length) buf = await runBuf(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-frames:v', '1', '-q:v', '2', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
  if (!buf.length) throw new Error('poster extraction produced 0 bytes');
  return buf;
}
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

const dirs = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()); } catch { return []; } };
const mp4s = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.') && /\.mp4$/i.test(n)); } catch { return []; } };
function idsForFolder(folder) {
  if (folder.includes(',')) {
    const parts = folder.split(',');
    const prefix = parts[0].replace(/[0-9]+$/, '');
    return parts.map((p, i) => (i === 0 ? p : prefix + p));
  }
  return [folder.replace(/^##(\d)$/, '##0$1')];
}

// ---- scan ----
const found = [];
for (const section of dirs(ROOT)) {
  const secPath = join(ROOT, section);
  const listingDirs = dirs(secPath);
  if (listingDirs.length) for (const l of listingDirs) { const v = mp4s(join(secPath, l)); if (v.length) found.push({ folder: l, dir: join(secPath, l), videos: v }); }
  else { const v = mp4s(secPath); if (v.length) found.push({ folder: section, dir: secPath, videos: v }); }
}

const rows = d1(`SELECT p.id, p.display_id, p.slug, p.segment, p.published, p.status,
  (SELECT COUNT(*) FROM property_media m WHERE m.property_id=p.id AND m.kind='video') AS videos,
  (SELECT COUNT(*) FROM property_media m WHERE m.property_id=p.id AND m.kind='photo') AS photos FROM properties p`);
const byId = new Map(rows.map((r) => [String(r.display_id).trim(), r]));

const jobs = [], skipped = [], unknown = [];
for (const f of found) {
  for (const id of idsForFolder(f.folder)) {
    const row = byId.get(id);
    if (!row) { unknown.push(f.folder); continue; }
    if (row.published !== 1 || row.status === 'rented') { skipped.push(`${id} not live`); continue; }
    if (row.videos > 0) { skipped.push(`${id} has video`); continue; }
    // Slug is interpolated into SQL and R2 keys — hard-fail on anything outside [a-z0-9-].
    if (!/^[a-z0-9-]+$/.test(row.slug)) throw new Error(`unsafe slug '${row.slug}' (folder ${f.folder})`);
    jobs.push({ id, slug: row.slug, propertyId: row.id, segment: row.segment, dir: f.dir, videos: f.videos, photos: row.photos });
  }
}
console.log(`folders with video: ${found.length}   listings to fill: ${jobs.length}   skipped: ${skipped.length}   no listing: ${unknown.length}`);
if (unknown.length) console.log('  ' + unknown.join(', '));

// Choose the clip by duration: the longest that still looks like an edited tour.
for (const j of jobs) {
  if (j.videos.length === 1) { j.pick = j.videos[0]; continue; }
  const withDur = [];
  for (const v of j.videos) withDur.push({ v, d: await duration(join(j.dir, v)) });
  const usable = withDur.filter((x) => x.d > 0 && x.d <= MAX_CLIP_S);
  j.pick = (usable.length ? usable : withDur).sort((a, b) => b.d - a.d)[0].v;
  j.picked = withDur.map((x) => `${x.v}=${Math.round(x.d)}s`).join(', ');
}
if (!APPLY) {
  for (const j of jobs) console.log(`  ${j.id.padEnd(6)} ${j.segment.padEnd(11)} ${j.pick}${j.picked ? `   [from ${j.videos.length}: ${j.picked}]` : ''}`);
  console.log('\ndry run — nothing written. add --apply');
  process.exit(0);
}

// ---- apply ----
const tmp = mkdtempSync(join(tmpdir(), 'rentoo-vid-'));
const failures = [];
let done = 0;
for (const j of jobs) {
  try {
    const src = join(j.dir, j.pick);
    const { ow, oh } = await outputDims(src);
    const wmPng = join(tmp, `wm-${j.slug}.png`);
    writeFileSync(wmPng, await watermarkFor(ow));
    const outMp4 = join(tmp, `${j.slug}-tour.mp4`);
    await transcode(src, wmPng, ow, oh, outMp4);
    const poster = await renderPosterSizes(await posterPng(src));

    // Posters first, then the heavy mp4, then the row — so a failure never leaves a listing
    // advertising a tour that will not play.
    for (const s of SIZES) {
      const p = join(tmp, `poster-${s.name}.webp`);
      writeFileSync(p, poster[s.name]);
      wrangler(['r2', 'object', 'put', `${BUCKET}/properties/${j.slug}/tour-${s.name}.webp`, `--file=${p}`, '--remote', '--content-type=image/webp']);
      rmSync(p, { force: true });
    }
    wrangler(['r2', 'object', 'put', `${BUCKET}/properties/${j.slug}/tour.mp4`, `--file=${outMp4}`, '--remote', '--content-type=video/mp4']);

    // display_order -1 puts the tour first in the gallery; is_cover only when there is no photo
    // cover to conflict with.
    d1(`DELETE FROM property_media WHERE kind='video' AND property_id='${j.propertyId}';
        INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked)
        VALUES ('${randomUUID()}','${j.propertyId}','video','properties/${j.slug}/tour',-1,${j.photos === 0 ? 1 : 0},${ow},${oh},1);`);
    rmSync(outMp4, { force: true }); rmSync(wmPng, { force: true });
    done++;
    console.log(`  [${done}/${jobs.length}] ${j.id.padEnd(6)} ${ow}x${oh} -> ${j.slug}`);
  } catch (e) { failures.push(`${j.id}: ${e.message}`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nuploaded ${done} tours`);
if (failures.length) { console.error(`failures (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
