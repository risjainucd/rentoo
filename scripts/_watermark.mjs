// scripts/_watermark.mjs — shared wordmark builder for the photo + video pipelines.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

export const WORDMARK_FRAC = 0.6;
export const WHITE_OPACITY = 0.18;
export const SHADOW_OPACITY = 0.22;

export function loadWordmarkSvgs(logoPath = 'Rentoo.svg') {
  const svgRaw = readFileSync(logoPath, 'utf8');
  return {
    svgWhite: svgRaw.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#ffffff"'),
    svgBlack: svgRaw.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#000000"'),
  };
}

// Multiply existing alpha by `opacity` via a uniform dest-in tile.
export async function setAlpha(buf, opacity) {
  return sharp(buf)
    .composite([{ input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png().toBuffer();
}

// Returns watermarkFor(imgWidth) -> padded transparent PNG: faint white wordmark + soft shadow.
export function makeWatermarkFactory(svgWhite, svgBlack) {
  const wmCache = new Map();
  return async function watermarkFor(imgWidth) {
    const wmW = Math.max(80, Math.round(imgWidth * WORDMARK_FRAC));
    if (wmCache.has(wmW)) return wmCache.get(wmW);
    const white = await sharp(Buffer.from(svgWhite)).resize({ width: wmW }).png().toBuffer();
    const { height: wmH } = await sharp(white).metadata();
    const black = await sharp(Buffer.from(svgBlack)).resize({ width: wmW }).blur(Math.max(1, wmW / 90)).png().toBuffer();
    const wf = await setAlpha(white, WHITE_OPACITY);
    const sf = await setAlpha(black, SHADOW_OPACITY);
    const pad = Math.round(wmW * 0.06);
    const off = Math.max(2, Math.round(wmW / 300));
    const wm = await sharp({ create: { width: wmW + pad * 2, height: wmH + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: sf, top: pad + off, left: pad + off }, { input: wf, top: pad, left: pad }])
      .png().toBuffer();
    wmCache.set(wmW, wm);
    return wm;
  };
}
