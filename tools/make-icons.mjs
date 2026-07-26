// Generates the PWA PNG icons.
//
// There is no ImageMagick / rsvg / headless browser on the build machine, so
// this rasterizes the mark by hand and encodes a PNG with Node's built-in
// zlib. The mark is deliberately all rectangles -- three cryptogram cells, two
// solved and one still blank -- because rectangles are trivial to rasterize
// without a drawing library.
//
// Run: node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SS = 4; // supersampling factor; corners would otherwise be jagged

const BG = [18, 20, 28, 255]; // #12141c
const ACCENT = [122, 162, 247, 255]; // #7aa2f7
const DIM = [90, 100, 130, 255]; // unsolved cell's underline

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
 */
function drawMark(canvas) {
  const S = canvas.size;

  fillRect(canvas, 0, 0, S, S, S * 0.2, BG);

  const cellW = S * 0.2;
  const gap = S * 0.06;
  const totalW = cellW * 3 + gap * 2;
  const left = (S - totalW) / 2;

  const blockTop = S * 0.31;
  const blockH = S * 0.25;
  const barTop = S * 0.62;
  const barH = S * 0.055;

  for (let i = 0; i < 3; i++) {
    const x = left + i * (cellW + gap);
    const solved = i !== 1;

    if (solved) {
      fillRect(canvas, x, blockTop, cellW, blockH, S * 0.035, ACCENT);
    }
    fillRect(canvas, x, barTop, cellW, barH, barH / 2, solved ? ACCENT : DIM);
  }
}

// --- run --------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  const canvas = createCanvas(size * SS);
  drawMark(canvas);
  const png = encodePNG(downsample(canvas, SS));
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
