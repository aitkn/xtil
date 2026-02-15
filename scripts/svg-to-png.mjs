import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const iconsDir = resolve(import.meta.dirname, '../public/icons');

// Map each output size to the SVG source to render from.
// Sizes <= 48 use their own simplified SVG; larger sizes use the detailed 128px SVG.
// icon-action.png: simplified design (from 48px SVG) rendered at 128px — used by
// all sub-128 manifest entries so Chrome downscales a crisp high-res source.
const sizeToSvg = {
  16: 16,
  24: 24,
  32: 32,
  48: 48,
  64: 128,
  96: 128,
  128: 128,
  256: 128,
  'action': { svg: 48, px: 128 },
};

// Render at 1x DPI so output pixels match the declared icon size exactly.
// Some browsers reject icons whose actual dimensions don't match the manifest.
const DPR = 1;

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: DPR });

for (const [key, value] of Object.entries(sizeToSvg)) {
  const isSpecial = typeof value === 'object';
  const svgSize = isSpecial ? value.svg : value;
  const outSize = isSpecial ? value.px : Number(key);
  const outName = isSpecial ? `icon-${key}.png` : `icon-${key}.png`;

  const page = await context.newPage();
  await page.setViewportSize({ width: outSize, height: outSize });
  await page.goto(`file://${iconsDir}/icon-${svgSize}.svg`);
  await page.waitForTimeout(300);
  const buf = await page.screenshot({ type: 'png', omitBackground: true });
  const outPath = `${iconsDir}/${outName}`;
  writeFileSync(outPath, buf);
  console.log(`${outPath} (${buf.length} bytes, ${outSize}x${outSize}px)`);
  await page.close();
}

await browser.close();
console.log('Done!');
