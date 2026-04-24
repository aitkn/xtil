import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const iconsDir = resolve(import.meta.dirname, '../public/icons');

// Render every PNG from the detailed 128-px SVG so Chrome has a single high-res
// source to downscale. icon-action.png is rendered at 256 so Chrome has headroom
// even on 2x HiDPI toolbar displays (128 / 96 / 64 / 48 / 32 / 16 all pull from here).
const sizeToSvg = {
  16: { svg: 128, px: 16 },
  24: { svg: 128, px: 24 },
  32: { svg: 128, px: 32 },
  48: { svg: 128, px: 48 },
  64: { svg: 128, px: 64 },
  96: { svg: 128, px: 96 },
  128: { svg: 128, px: 128 },
  256: { svg: 128, px: 256 },
  'action': { svg: 128, px: 256 },
};

// Render at 1x DPI so output pixels match the declared icon size exactly.
// Some browsers reject icons whose actual dimensions don't match the manifest.
const DPR = 1;

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: DPR });

for (const [key, value] of Object.entries(sizeToSvg)) {
  const svgSize = value.svg;
  const outSize = value.px;
  const outName = `icon-${key}.png`;

  const page = await context.newPage();
  await page.setViewportSize({ width: outSize, height: outSize });
  // Inline the SVG content so it fills the viewport regardless of intrinsic
  // width/height. Strips explicit width/height attrs and forces 100%/100%.
  // Strip width/height from the outer <svg> only (keep rect/child dims intact).
  const svgSource = readFileSync(`${iconsDir}/icon-${svgSize}.svg`, 'utf8')
    .replace(/<svg\b[^>]*?>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, ''));
  const html = `<!DOCTYPE html><html><head><style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; }
      svg { display: block; width: 100%; height: 100%; }
    </style></head><body>${svgSource}</body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: 'png', omitBackground: true });
  const outPath = `${iconsDir}/${outName}`;
  writeFileSync(outPath, buf);
  console.log(`${outPath} (${buf.length} bytes, ${outSize}x${outSize}px)`);
  await page.close();
}

await browser.close();
console.log('Done!');
