#!/usr/bin/env node

/**
 * Generate PNG icons for the xTil Chrome extension.
 *
 * Produces minimal valid PNG files at 16, 32, 48, and 128 pixel sizes.
 * Uses raw binary PNG construction — no external dependencies.
 *
 * NOTE: This is a legacy script. Use scripts/svg-to-png.mjs instead.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// --- PNG primitives ---

function crc32(buf) {
  // Standard CRC-32 used by PNG
  let table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function makePNG(width, height, rgbaPixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT — build raw scanlines then deflate
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      rawData[dstIdx]     = rgbaPixels[srcIdx];
      rawData[dstIdx + 1] = rgbaPixels[srcIdx + 1];
      rawData[dstIdx + 2] = rgbaPixels[srcIdx + 2];
      rawData[dstIdx + 3] = rgbaPixels[srcIdx + 3];
    }
  }
  const compressed = zlib.deflateSync(rawData);

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);
}

// --- Drawing helpers ---

function fillRect(pixels, w, h, x0, y0, rw, rh, r, g, b, a) {
  for (let y = y0; y < y0 + rh && y < h; y++) {
    for (let x = x0; x < x0 + rw && x < w; x++) {
      const i = (y * w + x) * 4;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
    }
  }
}

function setPixel(pixels, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  // Alpha blend
  const srcA = a / 255;
  const dstA = pixels[i+3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[i]   = Math.round((r * srcA + pixels[i]   * dstA * (1 - srcA)) / outA);
  pixels[i+1] = Math.round((g * srcA + pixels[i+1] * dstA * (1 - srcA)) / outA);
  pixels[i+2] = Math.round((b * srcA + pixels[i+2] * dstA * (1 - srcA)) / outA);
  pixels[i+3] = Math.round(outA * 255);
}

function drawRoundedRect(pixels, w, h, x0, y0, rw, rh, radius, r, g, b, a) {
  for (let y = y0; y < y0 + rh && y < h; y++) {
    for (let x = x0; x < x0 + rw && x < w; x++) {
      const lx = x - x0;
      const ly = y - y0;
      // Check if inside rounded corners
      let inside = true;
      // Top-left corner
      if (lx < radius && ly < radius) {
        const dx = radius - lx - 0.5;
        const dy = radius - ly - 0.5;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      // Top-right corner
      if (lx >= rw - radius && ly < radius) {
        const dx = lx - (rw - radius) + 0.5;
        const dy = radius - ly - 0.5;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      // Bottom-left corner
      if (lx < radius && ly >= rh - radius) {
        const dx = radius - lx - 0.5;
        const dy = ly - (rh - radius) + 0.5;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      // Bottom-right corner
      if (lx >= rw - radius && ly >= rh - radius) {
        const dx = lx - (rw - radius) + 0.5;
        const dy = ly - (rh - radius) + 0.5;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      if (inside) {
        setPixel(pixels, w, x, y, r, g, b, a);
      }
    }
  }
}

// --- Bitmap font for "TL" ---
// Each letter is defined as a grid of 1s and 0s.
// We'll scale them to fit each icon size.

// 7x9 bitmap font glyphs
const GLYPH_T = [
  [1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
];

const GLYPH_L = [
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,0,0,0,0,0,0],
  [1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1],
];

const GLYPH_W = 7;
const GLYPH_H = 9;

function drawGlyph(pixels, imgW, glyph, startX, startY, scale, r, g, b, a) {
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (glyph[gy][gx]) {
        // Fill a scale x scale block
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = startX + gx * scale + sx;
            const py = startY + gy * scale + sy;
            setPixel(pixels, imgW, px, py, r, g, b, a);
          }
        }
      }
    }
  }
}

function generateIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Draw blue rounded rectangle background
  const radius = Math.max(2, Math.round(size * 0.15));
  drawRoundedRect(pixels, size, size, 0, 0, size, size, radius, 0x25, 0x63, 0xEB, 255);

  // Calculate text scale and positioning
  // Two glyphs side by side: total width = 2 * GLYPH_W + 1 gap (in glyph units)
  // We want the text to fill roughly 75% of the icon width
  const totalGlyphUnitsW = 2 * GLYPH_W + 1; // "T" + gap + "L"
  const targetTextWidth = Math.round(size * 0.75);
  const scale = Math.max(1, Math.floor(targetTextWidth / totalGlyphUnitsW));

  const actualTextW = totalGlyphUnitsW * scale;
  const actualTextH = GLYPH_H * scale;

  const startX = Math.round((size - actualTextW) / 2);
  const startY = Math.round((size - actualTextH) / 2);

  // Draw "T"
  drawGlyph(pixels, size, GLYPH_T, startX, startY, scale, 255, 255, 255, 255);
  // Draw "L" — offset by (GLYPH_W + 1) * scale
  drawGlyph(pixels, size, GLYPH_L, startX + (GLYPH_W + 1) * scale, startY, scale, 255, 255, 255, 255);

  return makePNG(size, size, pixels);
}

// --- Main ---
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = generateIcon(size);
  const outPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}

console.log('Done.');
