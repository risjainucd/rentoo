// Generates the icon / social assets from the two source marks in public/.
// Re-run after changing public/Rentoo.svg or public/Rentooicon.svg:
//   node scripts/brand-assets.mjs
//
// The artwork is dark navy (#0E253E…), nearly the same as the --jaipur-navy theme colour, so
// every tile here uses the light --paper ground. A navy tile would render the mark invisible.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const PAPER = '#FAF7EE';                 // --paper
const ICON = 'public/Rentooicon.svg';
const WORDMARK = 'public/Rentoo.svg';
const bg = {
  r: parseInt(PAPER.slice(1, 3), 16),
  g: parseInt(PAPER.slice(3, 5), 16),
  b: parseInt(PAPER.slice(5, 7), 16),
  alpha: 1,
};

// Render an SVG to `size`, inset by `padPct` of the canvas on every side, on an opaque ground.
async function tile(src, size, padPct, out) {
  const inner = Math.round(size * (1 - padPct * 2));
  const art = await sharp(readFileSync(src), { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const off = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: art, top: off, left: off }])
    .png().toFile(out);
  return out;
}

// apple-touch-icon: iOS ignores alpha and composites onto black, and applies its own squircle
// mask — so ship an opaque, full-bleed square with a little internal padding.
await tile(ICON, 180, 0.11, 'public/apple-touch-icon.png');
// purpose:"any" — shown as-is, so only a little padding.
await tile(ICON, 192, 0.08, 'public/icon-192.png');
await tile(ICON, 512, 0.08, 'public/icon-512.png');
// purpose:"maskable" — the platform crops to a circle of radius 40% of the icon, so all artwork
// must sit inside the central 80%. Separate file: one image cannot serve both purposes.
await tile(ICON, 512, 0.24, 'public/icon-512-maskable.png');

const ico = await tile(ICON, 32, 0.04, '/tmp/favicon-32.png');
writeFileSync('public/favicon.ico', await pngToIco([ico]));

// Open Graph: the wordmark, not the monogram — a monogram at 1200px tells a first-time viewer
// nothing. 1200x630 is what every unfurler crops to.
const OG_W = 1200, OG_H = 630;
const mark = await sharp(readFileSync(WORDMARK), { density: 384 })
  .resize({ width: Math.round(OG_W * 0.62) }).png().toBuffer();
const { height: mh } = await sharp(mark).metadata();
await sharp({ create: { width: OG_W, height: OG_H, channels: 4, background: bg } })
  .composite([{ input: mark, top: Math.round((OG_H - mh) / 2), left: Math.round(OG_W * 0.19) }])
  // WhatsApp is the main share channel here and drops previews well under Meta's stated 600KB,
  // so this stays comfortably small rather than merely legal.
  .jpeg({ quality: 86, progressive: true, chromaSubsampling: '4:4:4' })
  .toFile('public/og-image.jpg');

// ── Verify, rather than trust, the things that silently break on a device ──
const problems = [];

// iOS ignores the alpha channel and composites transparent pixels onto BLACK, which would sink
// this near-black mark into the tile. Same reasoning for the manifest icons on Android.
for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
  const { isOpaque } = await sharp(`public/${f}`).stats();
  if (!isOpaque) problems.push(`${f} is not fully opaque`);
}

// Maskable icons are cropped to a circle of radius 40% of the icon; anything outside is at risk.
{
  const size = 512;
  const { data, info } = await sharp('public/icon-512-maskable.png').raw().toBuffer({ resolveWithObject: true });
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * info.channels;
    if (data[i] < 0xF0 || data[i + 1] < 0xEC || data[i + 2] < 0xE2) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const worst = Math.max(...[[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]
    .map(([x, y]) => Math.hypot(x - size / 2, y - size / 2)));
  const safeR = size * 0.4;
  if (worst > safeR * 0.95) problems.push(`maskable artwork reaches ${Math.round(worst / safeR * 100)}% of the safe radius`);
}

// WhatsApp is the main share channel and drops previews well below Meta's stated 600KB ceiling.
{
  const { width, height, size } = await sharp('public/og-image.jpg').metadata();
  if (width !== OG_W || height !== OG_H) problems.push(`og-image is ${width}x${height}, expected ${OG_W}x${OG_H}`);
  if (size > 250_000) problems.push(`og-image is ${Math.round(size / 1024)}KB, over the 250KB budget`);
}

if (problems.length) {
  console.error('brand asset checks failed:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('brand assets written to public/ and verified');
