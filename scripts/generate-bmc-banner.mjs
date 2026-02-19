import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const WIDTH = 1600;
const HEIGHT = 400;
const outPath = resolve(import.meta.dirname, '../assets/bmc-cover.png');

const iconSvg = readFileSync(
  resolve(import.meta.dirname, '../public/icons/icon-128.svg'),
  'utf-8'
);
// Base64-encode the SVG for inline embedding
const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@700&family=Outfit:wght@300;400&display=swap');

  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #06050e;
    position: relative;
    font-family: 'Outfit', sans-serif;
  }

  /* Gradient base layer */
  .bg-gradient {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, #06050e 0%, #0b0918 30%, #13102a 60%, #0b0918 100%);
  }

  /* Orb glows matching website */
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.4;
  }
  .orb-1 {
    width: 500px; height: 500px;
    top: -150px; left: 100px;
    background: radial-gradient(circle, #4f46e5 0%, transparent 70%);
  }
  .orb-2 {
    width: 400px; height: 400px;
    top: -50px; right: 200px;
    background: radial-gradient(circle, #7c3aed 0%, transparent 70%);
    opacity: 0.3;
  }
  .orb-3 {
    width: 350px; height: 350px;
    bottom: -100px; left: 40%;
    background: radial-gradient(circle, #6d5ff5 0%, transparent 70%);
    opacity: 0.25;
  }
  .orb-4 {
    width: 300px; height: 300px;
    bottom: -80px; right: 80px;
    background: radial-gradient(circle, #a78bfa 0%, transparent 70%);
    opacity: 0.15;
  }

  /* Stars / sparkles */
  .star {
    position: absolute;
    width: 3px; height: 3px;
    background: white;
    border-radius: 50%;
    opacity: 0.4;
  }
  .star.bright {
    width: 4px; height: 4px;
    opacity: 0.6;
    box-shadow: 0 0 6px 2px rgba(167, 139, 250, 0.5);
  }
  .star.dim { opacity: 0.2; width: 2px; height: 2px; }

  /* Grid pattern overlay */
  .grid-overlay {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(109, 95, 245, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(109, 95, 245, 0.03) 1px, transparent 1px);
    background-size: 60px 60px;
  }

  /* Noise texture */
  .noise {
    position: absolute;
    inset: 0;
    opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 256px 256px;
  }

  /* Center content */
  .content {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    z-index: 10;
  }

  .icon-wrapper {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
  }
  .icon-wrapper img {
    width: 100%;
    height: 100%;
  }

  .text-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .brand-name {
    font-family: 'DM Sans', sans-serif;
    font-weight: 700;
    font-size: 56px;
    color: #e8e5f5;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .tagline {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 20px;
    color: #827ca0;
    letter-spacing: 0.04em;
  }

  /* Accent line below content */
  .accent-line {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, transparent, #6d5ff5 30%, #a78bfa 50%, #6d5ff5 70%, transparent);
    opacity: 0.6;
  }
</style>
</head>
<body>
  <div class="bg-gradient"></div>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
  <div class="orb orb-4"></div>

  <!-- Stars scattered across the banner -->
  <div class="star" style="top:40px;left:120px;"></div>
  <div class="star bright" style="top:80px;left:300px;"></div>
  <div class="star dim" style="top:150px;left:50px;"></div>
  <div class="star" style="top:60px;left:500px;"></div>
  <div class="star bright" style="top:320px;left:180px;"></div>
  <div class="star dim" style="top:200px;left:700px;"></div>
  <div class="star" style="top:30px;left:900px;"></div>
  <div class="star bright" style="top:350px;left:1050px;"></div>
  <div class="star dim" style="top:100px;left:1200px;"></div>
  <div class="star" style="top:280px;left:1400px;"></div>
  <div class="star bright" style="top:50px;left:1350px;"></div>
  <div class="star dim" style="top:330px;left:600px;"></div>
  <div class="star" style="top:180px;left:1500px;"></div>
  <div class="star dim" style="top:90px;left:750px;"></div>
  <div class="star" style="top:260px;left:350px;"></div>
  <div class="star bright" style="top:140px;left:1100px;"></div>
  <div class="star dim" style="top:370px;left:800px;"></div>
  <div class="star" style="top:20px;left:1050px;"></div>
  <div class="star dim" style="top:300px;left:1300px;"></div>
  <div class="star bright" style="top:220px;left:200px;"></div>

  <div class="grid-overlay"></div>
  <div class="noise"></div>

  <div class="content">
    <div class="icon-wrapper">
      <img src="${iconDataUri}" alt="xTil">
    </div>
    <div class="text-block">
      <div class="brand-name">xTil</div>
      <div class="tagline">Extract the signal. Distill the insight.</div>
    </div>
  </div>

  <div class="accent-line"></div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(outPath, buf);
  console.log(`Banner saved to ${outPath} (${buf.length} bytes, ${WIDTH}x${HEIGHT}px)`);
} finally {
  await browser.close();
}
