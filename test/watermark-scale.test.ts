import { expect, test, describe } from 'vitest';
import { WORDMARK_FRAC } from '../src/lib/admin-photos';
import pipelineSrc from '../scripts/_watermark.mjs?raw';

// The watermark is rendered from public/Rentoo.svg and sized by WIDTH:
//   wmW = imgWidth * WORDMARK_FRAC
// That asset used to be a 666x375 canvas holding a 441x81 wordmark, so only 66.3% of the sized
// box was ink and the mark landed at ~0.6 * 0.663 = 39.8% of the photo width. Cropping the SVG
// to its artwork made the box all ink, which would have stamped the 1.50x larger mark on every
// new upload while the 705 already-uploaded photos kept the old one. The constant absorbs that.
const LEGACY_FRAC = 0.6;          // pre-crop constant
const LEGACY_INK_FILL = 0.6627;   // 441.326 / 666 — ink as a fraction of the old canvas width
const VISIBLE_FRAC = LEGACY_FRAC * LEGACY_INK_FILL;

describe('watermark scale', () => {
  test('stamps the wordmark at the same visible width as the existing photos', () => {
    // Post-crop the asset is all ink, so WORDMARK_FRAC *is* the visible fraction.
    expect(WORDMARK_FRAC).toBeCloseTo(VISIBLE_FRAC, 3);
  });

  test('the browser uploader and the offline pipeline agree', () => {
    // Two copies of this constant exist; a photo watermarked by the admin UI and one watermarked
    // by scripts/video-upload.mjs have to come out identical.
    const fromPipeline = Number(pipelineSrc.match(/WORDMARK_FRAC\s*=\s*([\d.]+)/)![1]);
    expect(fromPipeline).toBe(WORDMARK_FRAC);
  });
});
