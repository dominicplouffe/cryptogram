// Generates the PWA PNG icons and the source images the app stores need.
//
// There is no ImageMagick / rsvg / headless browser on the build machine, so
// this rasterizes the mark by hand and encodes a PNG with Node's built-in
// zlib. The mark is deliberately all rectangles -- three cryptogram cells, two
// solved and one still blank -- because rectangles are trivial to rasterize
// without a drawing library.
//
// Alongside the PWA icons in icons/, this writes native/assets/: a 1024 store
// icon, the Android adaptive-icon foreground/background pair, and 2732 splash
// squares, in the names `@capacitor/assets` expects. `npm run assets` inside
// native/ then fans them out to every density both platforms want.
//
// Run: node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'icons');
const NATIVE_DIR = join(ROOT, 'native', 'assets');
const SS = 4; // supersampling factor; corners would otherwise be jagged

const BG = [21, 15, 38, 255]; // #150f26 — the Arcade plum ground
const ACCENT = [255, 93, 115, 255]; // #ff5d73 — the Arcade coral
const DIM = [90, 72, 130, 255]; // #5a4882 — unsolved cell's underline

// --- tiny RGBA raster -------------------------------------------------------

function createCanvas(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(canvas, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  const alpha = a / 255;
  const inv = 1 - alpha;
  const d = canvas.data;
  d[i] = r * alpha + d[i] * inv;
  d[i + 1] = g * alpha + d[i + 1] * inv;
  d[i + 2] = b * alpha + d[i + 2] * inv;
  d[i + 3] = Math.min(255, a + d[i + 3] * inv);
}

/** Filled rectangle with optional corner radius. */
function fillRect(canvas, x, y, w, h, radius, color) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w);
  const y1 = Math.round(y + h);
  const r = Math.min(radius, w / 2, h / 2);

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (r > 0) {
        // Distance test only inside the four corner boxes.
        const cx = px < x0 + r ? x0 + r : px >= x1 - r ? x1 - r - 1 : px;
        const cy = py < y0 + r ? y0 + r : py >= y1 - r ? y1 - r - 1 : py;
        if (cx !== px || cy !== py) {
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy > r * r) continue;
        }
      }
      blend(canvas, px, py, color);
    }
  }
}

/** Box-filter down to the target size, which is what smooths the edges. */
function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const out = createCanvas(size);
  const area = factor * factor;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          r += canvas.data[i];
          g += canvas.data[i + 1];
          b += canvas.data[i + 2];
          a += canvas.data[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out.data[o] = r / area;
      out.data[o + 1] = g / area;
      out.data[o + 2] = b / area;
      out.data[o + 3] = a / area;
    }
  }
  return out;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(canvas) {
  const { size, data } = canvas;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size * 4; x++) raw[offset++] = data[y * size * 4 + x];
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the mark ---------------------------------------------------------------

/**
 * Three cryptogram cells in a row: two solved (filled block over an accent
 * underline) and one still blank (bare dim underline). All geometry is
 * expressed as a fraction of the canvas, and content stays inside the middle
 * 72% so the icon survives a maskable circle crop.
 *
 * @param {object} [opts]
 * @param {number[]|null} [opts.bg] background color, or null for transparent
 * @param {number} [opts.radius] background corner radius as a canvas fraction
 * @param {number} [opts.scale] shrink the cells about the center; 1 is the PWA
 *   icon. The adaptive-icon and splash variants need the mark inside a smaller
 *   safe zone than the maskable-icon 72%.
 */
function drawMark(canvas, { bg = BG, radius = 0.2, scale = 1 } = {}) {
  const S = canvas.size;

  if (bg) fillRect(canvas, 0, 0, S, S, S * radius, bg);
  if (scale === 0) return; // background-only variant

  // x' = mid + (x - mid) * scale, precomputed on the fractions. scale 1 keeps
  // the exact original expression so the PWA icons stay byte-identical.
  const f = scale === 1 ? (v) => S * v : (v) => S * (0.5 + (v - 0.5) * scale);
  const d = (v) => S * v * scale;

  const cellW = d(0.2);
  const gap = d(0.06);
  const totalW = cellW * 3 + gap * 2;
  const left = (S - totalW) / 2;

  const blockTop = f(0.31);
  const blockH = d(0.25);
  const barTop = f(0.62);
  const barH = d(0.055);

  for (let i = 0; i < 3; i++) {
    const x = left + i * (cellW + gap);
    const solved = i !== 1;

    if (solved) {
      fillRect(canvas, x, blockTop, cellW, blockH, d(0.035), ACCENT);
    }
    fillRect(canvas, x, barTop, cellW, barH, barH / 2, solved ? ACCENT : DIM);
  }
}

// --- run --------------------------------------------------------------------

/** @param {number} ss supersampling; the 2732 splashes use 2 to keep the
    intermediate raster under control (rectangles barely need smoothing). */
function render(file, size, opts, ss = SS) {
  const canvas = createCanvas(size * ss);
  drawMark(canvas, opts);
  const png = encodePNG(downsample(canvas, ss));
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(NATIVE_DIR, { recursive: true });

// The PWA icons: rounded plum tile, mark at full size.
for (const size of [192, 512]) {
  render(join(OUT_DIR, `icon-${size}.png`), size, {});
}

// The store icon: full-bleed square, no alpha corners -- the OS does the
// masking, and App Store Connect rejects transparency.
render(join(NATIVE_DIR, 'icon-only.png'), 1024, { radius: 0 });

// Android adaptive icon: the launcher composes foreground over background and
// may crop to a circle of ~61% of the canvas, so the mark shrinks to keep its
// corners inside that circle (0.7 puts them at ~0.29 of the canvas from
// center, safely under the 0.306 limit).
render(join(NATIVE_DIR, 'icon-foreground.png'), 1024, { bg: null, scale: 0.7 });
render(join(NATIVE_DIR, 'icon-background.png'), 1024, { radius: 0, scale: 0 });

// Splash squares: capacitor-assets center-crops these to every device aspect,
// so the mark stays small in the middle. One plum design for both themes --
// the app's identity color, and it matches the configured WebView background.
for (const name of ['splash.png', 'splash-dark.png']) {
  render(join(NATIVE_DIR, name), 2732, { radius: 0, scale: 0.35 }, 2);
}
