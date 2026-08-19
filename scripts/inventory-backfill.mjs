// Backfill photos for LIVE listings that have none, from a local copy of the RENTOO Drive folder.
//
//   node scripts/inventory-backfill.mjs "/path/to/RENTOO"            # dry run
//   node scripts/inventory-backfill.mjs "/path/to/RENTOO" --apply    # write R2 + D1
//
// Reads local files rather than the Drive API: Drive's public folder page only embeds the first
// ~50 entries, so scraping silently saw 659 of 1319 images. Export the folder and point this at it.
//
// Scope guard: only listings that are published, not rented, and have ZERO photos today. That is
// what makes this safely re-runnable without a source-file column on property_media — a listing
// that already has photos is never touched, so a second run cannot duplicate or reorder anything.
//
// R2 and D1 are written through the authenticated wrangler session; no R2 access keys needed.
import { readdirSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadWordmarkSvgs, makeWatermarkFactory } from './_watermark.mjs';

// slice(2): argv[0] is the node binary and argv[1] this script — both look like paths.
const ROOT = process.argv.slice(2).find((a) => !a.startsWith('-'));
const APPLY = process.argv.includes('--apply');
if (!ROOT) { console.error('usage: node scripts/inventory-backfill.mjs "/path/to/RENTOO" [--apply]'); process.exit(1); }

const BUCKET = 'rentoo-photos';
const DB = 'rentoo-listings';
const SIZES = [
  { name: 'card', width: 600, quality: 72 },
  { name: 'gallery', width: 1200, quality: 80 },
  { name: 'full', width: 2000, quality: 82 },
];
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 4;

const { svgWhite, svgBlack } = loadWordmarkSvgs('public/Rentoo.svg');
const watermarkFor = makeWatermarkFactory(svgWhite, svgBlack);

const wrangler = (args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function d1(sql) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const dirs = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()); } catch { return []; } };
const images = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.') && IMAGE_RE.test(n) && statSync(join(p, n)).isFile()); } catch { return []; } };
// "2.jpg" before "10.jpg", so the cover photo (index 0) is stable across runs.
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// '##1' -> '##01' (D1 zero-pads premium ids). 'C-12,13' -> ['C-12','C-13'] (one shared folder).
function idsForFolder(folder) {
  if (folder.includes(',')) {
    const parts = folder.split(',');
    const prefix = parts[0].replace(/[0-9]+$/, '');
    return parts.map((p, i) => (i === 0 ? p : prefix + p));
  }
  return [folder.replace(/^##(\d)$/, '##0$1')];
}

// ---- scan ----
const found = [];   // { folder, dir, files[] }
for (const section of dirs(ROOT)) {
  const secPath = join(ROOT, section);
  const listingDirs = dirs(secPath);
  if (listingDirs.length) {
    for (const l of listingDirs) found.push({ folder: l, dir: join(secPath, l), files: images(join(secPath, l)).sort(natural) });
  } else {
    // A section that is itself one listing's folder (e.g. C-7 sitting at the root).
    const loose = images(secPath);
    if (loose.length) found.push({ folder: section, dir: secPath, files: loose.sort(natural) });
  }
}

const rows = d1(`SELECT p.id, p.display_id, p.slug, p.segment, p.published, p.status,
  (SELECT COUNT(*) FROM property_media m WHERE m.property_id=p.id AND m.kind='photo') AS photos FROM properties p`);
const byId = new Map(rows.map((r) => [String(r.display_id).trim(), r]));

const jobs = [], skipped = [], unknown = [];
for (const f of found) {
  for (const id of idsForFolder(f.folder)) {
    const row = byId.get(id);
    if (!row) { unknown.push(`${f.folder} -> ${id}`); continue; }
    if (row.published !== 1 || row.status === 'rented') { skipped.push(`${id} not live`); continue; }
    if (row.photos > 0) { skipped.push(`${id} has ${row.photos}`); continue; }
    if (!f.files.length) { skipped.push(`${id} folder empty`); continue; }
    jobs.push({ id, slug: row.slug, propertyId: row.id, segment: row.segment, dir: f.dir, files: f.files });
  }
}

const totalImages = jobs.reduce((n, j) => n + j.files.length, 0);
console.log(`scanned folders: ${found.length}   images on disk: ${found.reduce((n, f) => n + f.files.length, 0)}`);
console.log(`listings to fill: ${jobs.length}   images to process: ${totalImages}   R2 objects: ${totalImages * SIZES.length}`);
console.log(`skipped: ${skipped.length}   folders with no matching listing: ${unknown.length}`);
if (unknown.length) console.log('  ' + unknown.join(', '));
if (!APPLY) {
  const bySeg = {};
  for (const j of jobs) bySeg[j.segment] = (bySeg[j.segment] || 0) + 1;
  console.log('  by segment:', JSON.stringify(bySeg));
  for (const j of jobs) console.log(`  ${j.id.padEnd(6)} ${j.segment.padEnd(11)} ${String(j.files.length).padStart(3)} -> ${j.slug}`);
  console.log('\ndry run — nothing written. add --apply');
  process.exit(0);
}

// ---- apply ----
async function renderSizes(srcPath) {
  const base = sharp(srcPath, { failOn: 'none' }).rotate();   // auto-orient from EXIF
  const out = {};
  let dims = null;
  for (const s of SIZES) {
    const resized = await base.clone().resize({ width: s.width, withoutEnlargement: true }).toBuffer();
    const meta = await sharp(resized).metadata();
    let wm = await watermarkFor(meta.width);
    const wmMeta = await sharp(wm).metadata();
    if (wmMeta.width > meta.width || wmMeta.height > meta.height) {
      wm = await sharp(wm).resize({ width: Math.round(meta.width * 0.92), height: Math.round(meta.height * 0.92), fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    }
    out[s.name] = await sharp(resized).composite([{ input: wm, gravity: 'center' }]).webp({ quality: s.quality }).toBuffer();
    if (s.name === 'gallery') dims = { w: meta.width, h: meta.height };
  }
  if (!dims) { const m = await sharp(out.full).metadata(); dims = { w: m.width, h: m.height }; }
  return { out, dims };
}
async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

const tmp = mkdtempSync(join(tmpdir(), 'rentoo-fill-'));
const failures = [];
let filled = 0;
for (const j of jobs) {
  const media = [];
  await pool(j.files, CONCURRENCY, async (file, index) => {
    try {
      const { out, dims } = await renderSizes(join(j.dir, file));
      for (const s of SIZES) {
        const objPath = join(tmp, `${index}-${s.name}.webp`);
        writeFileSync(objPath, out[s.name]);
        wrangler(['r2', 'object', 'put', `${BUCKET}/properties/${j.slug}/${index}-${s.name}.webp`,
          `--file=${objPath}`, '--remote', '--content-type=image/webp']);
        rmSync(objPath, { force: true });
      }
      media.push({ index, w: dims.w, h: dims.h });
    } catch (e) { failures.push(`${j.id} #${index} ${file}: ${e.message}`); }
  });

  if (!media.length) { console.log(`  ${j.id}: nothing uploaded, D1 left alone`); continue; }
  // Rows are written only after every object for this listing is up, so an interrupted run never
  // leaves a listing pointing at images that do not exist.
  media.sort((a, b) => a.index - b.index);
  const values = media.map((m, order) =>
    `('${randomUUID()}','${j.propertyId}','photo','properties/${j.slug}/${m.index}',${order},${order === 0 ? 1 : 0},${m.w},${m.h},1)`).join(',');
  d1(`DELETE FROM property_media WHERE property_id='${j.propertyId}' AND kind='photo';
      INSERT INTO property_media (id,property_id,kind,r2_key,display_order,is_cover,width,height,watermarked) VALUES ${values};`);
  filled++;
  console.log(`  [${filled}/${jobs.length}] ${j.id.padEnd(6)} ${String(media.length).padStart(3)} photos -> ${j.slug}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nfilled ${filled} listings`);
if (failures.length) { console.error(`failures (${failures.length}):\n  ` + failures.join('\n  ')); process.exit(1); }
