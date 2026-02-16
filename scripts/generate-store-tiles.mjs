import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '..', 'website', 'public', 'store');

// Platform badge SVGs (inline, monochrome white)
const BADGES = {
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  reddit: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  gdocs: `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zm-.545 10.455H7.09v-1.455h7.09v1.455zm2.727-3.273H7.091v-1.454h9.818v1.454zm0-3.272H7.091V9.182h9.818v1.455zM14.727 0l6 6h-6V0z"/></svg>`,
};

function badgesHTML(size = 'small') {
  const isSmall = size === 'small';
  const gap = isSmall ? '5px' : '10px';
  const pad = isSmall ? '3px 6px' : '5px 12px';
  const fontSize = isSmall ? '0.48rem' : '0.72rem';
  const iconGap = isSmall ? '3px' : '6px';
  const borderRadius = isSmall ? '5px' : '8px';
  const labels = [
    { svg: BADGES.youtube, text: isSmall ? '' : 'YouTube' },
    { svg: BADGES.github, text: isSmall ? '' : 'GitHub' },
    { svg: BADGES.reddit, text: isSmall ? '' : 'Reddit' },
    { svg: BADGES.x, text: '' },
    { svg: BADGES.gdocs, text: isSmall ? '' : 'Docs' },
  ];
  return `<div style="display:flex;align-items:center;gap:${gap};flex-wrap:nowrap;">
    ${labels.map(b => `<div style="display:flex;align-items:center;gap:${iconGap};padding:${pad};border-radius:${borderRadius};background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.45);font-family:'Outfit',sans-serif;font-size:${fontSize};font-weight:500;white-space:nowrap;">${b.svg}${b.text ? `<span>${b.text}</span>` : ''}</div>`).join('')}
  </div>`;
}

async function main() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();

  // --- Small promo tile: 440x280 ---
  console.log('Generating small promo tile (440x280)...');
  const smallCtx = await browser.newContext({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 2,
  });
  const smallPage = await smallCtx.newPage();
  await smallPage.goto('http://localhost:8124/website/public/index.html');
  await smallPage.waitForLoadState('networkidle');
  await smallPage.waitForTimeout(2000);
  await smallPage.evaluate(() => {
    document.querySelectorAll('img[src="/icon.svg"]').forEach(img => { img.src = '/website/public/icon.svg'; });
  });
  await smallPage.waitForTimeout(500);

  const smallBadges = badgesHTML('small');
  await smallPage.evaluate((badges) => {
    const panels = document.querySelectorAll('.mock-panel-card');
    const ytPanel = panels[1]?.cloneNode(true);   // YouTube
    const diaPanel = panels[3]?.cloneNode(true);   // Diagrams

    const overlay = document.createElement('div');
    overlay.id = 'tile-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 440px; height: 280px;
      background: #06050e; z-index: 99999;
      overflow: hidden;
    `;

    // Background glows
    const g1 = document.createElement('div');
    g1.style.cssText = `
      position: absolute; top: -40%; right: 5%; width: 350px; height: 350px;
      background: radial-gradient(circle, rgba(109,95,245,0.14) 0%, transparent 60%);
      pointer-events: none;
    `;
    overlay.appendChild(g1);
    const g2 = document.createElement('div');
    g2.style.cssText = `
      position: absolute; bottom: -30%; left: 20%; width: 300px; height: 300px;
      background: radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 60%);
      pointer-events: none;
    `;
    overlay.appendChild(g2);

    // Left: branding + tagline — pushed up
    const textDiv = document.createElement('div');
    textDiv.style.cssText = `
      position: absolute; top: 36px; left: 24px; z-index: 2; max-width: 175px;
    `;
    textDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <img src="/website/public/icon.svg" style="width:36px;height:36px;">
        <span style="font-family:'DM Sans',sans-serif;font-size:1.6rem;font-weight:700;color:#fff;letter-spacing:-0.02em;">xTil</span>
      </div>
      <div style="font-family:'DM Sans',sans-serif;font-size:1.15rem;font-weight:600;color:#fff;line-height:1.3;margin-bottom:8px;">
        <span style="background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Extract</span> content,<br>
        <span style="background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">distill</span> knowledge
      </div>
      <div style="font-family:'Outfit',sans-serif;font-size:0.72rem;color:rgba(255,255,255,0.4);line-height:1.5;">
        AI-powered Chrome extension that turns any web page into structured insights.
      </div>
    `;

    // Platform badges at bottom-left
    const badgesDiv = document.createElement('div');
    badgesDiv.style.cssText = `
      position: absolute; bottom: 16px; left: 24px; z-index: 2;
    `;
    badgesDiv.innerHTML = badges;

    // Diagram panel — behind YouTube, tilted left, showing the flowchart
    if (diaPanel) {
      // Hide everything before the Summary section (which contains the diagram)
      const diaSections = diaPanel.querySelectorAll('.mock-panel-scroll > *');
      for (const el of diaSections) {
        if (el.querySelector('.mock-diagram')) break;
        el.style.display = 'none';
      }
      diaPanel.style.cssText = `
        position: absolute; top: -15px; left: 140px; z-index: 1;
        width: 210px; max-height: none; overflow: hidden;
        transform: rotate(-3.5deg) scale(0.78); transform-origin: top center;
        opacity: 0.6; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      `;
      const dFade = document.createElement('div');
      dFade.style.cssText = `
        position: absolute; bottom: 0; left: 0; right: 0; height: 40px;
        background: linear-gradient(transparent, #06050e); pointer-events: none; z-index: 2;
      `;
      const diaWrap = document.createElement('div');
      diaWrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      diaWrap.appendChild(diaPanel);
      diaWrap.appendChild(dFade);
      overlay.appendChild(diaWrap);
    }

    // YouTube panel — on top, slight tilt, positioned center-right, showing more content
    if (ytPanel) {
      ytPanel.style.cssText = `
        position: absolute; top: -8px; left: 225px; z-index: 3;
        width: 215px; max-height: none; overflow: hidden;
        transform: rotate(2deg) scale(0.82); transform-origin: top center;
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(109,95,245,0.25), 0 0 0 1px rgba(255,255,255,0.08);
      `;
      // Very short fade at bottom edge
      const yFade = document.createElement('div');
      yFade.style.cssText = `
        position: absolute; bottom: 0; left: 0; right: 0; height: 20px;
        background: linear-gradient(transparent, #06050e); pointer-events: none; z-index: 2;
      `;
      const ytWrap = document.createElement('div');
      ytWrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      ytWrap.appendChild(ytPanel);
      ytWrap.appendChild(yFade);
      overlay.appendChild(ytWrap);
    }

    overlay.appendChild(textDiv);
    overlay.appendChild(badgesDiv);
    document.body.appendChild(overlay);
  }, smallBadges);

  await smallPage.waitForTimeout(500);
  await smallPage.screenshot({
    path: path.join(outputDir, 'promo-small-440x280.png'),
    clip: { x: 0, y: 0, width: 440, height: 280 },
  });
  // Resize from 880x560 (2x) to exact 440x280 for Chrome Web Store
  const smallPath = path.join(outputDir, 'promo-small-440x280.png');
  execSync(`convert "${smallPath}" -resize 440x280 "${smallPath}"`);
  console.log('  ✓ promo-small-440x280.png (resized to 440x280)');
  await smallCtx.close();

  // --- Marquee promo tile: 1400x560 ---
  console.log('Generating marquee promo tile (1400x560)...');
  const marqueeCtx = await browser.newContext({
    viewport: { width: 1400, height: 560 },
    deviceScaleFactor: 1,
  });
  const marqueePage = await marqueeCtx.newPage();
  await marqueePage.goto('http://localhost:8124/website/public/index.html');
  await marqueePage.waitForLoadState('networkidle');
  await marqueePage.waitForTimeout(2000);
  await marqueePage.evaluate(() => {
    document.querySelectorAll('img[src="/icon.svg"]').forEach(img => { img.src = '/website/public/icon.svg'; });
  });
  await marqueePage.waitForTimeout(500);

  const marqueeBadges = badgesHTML('large');
  await marqueePage.evaluate((badges) => {
    const panels = document.querySelectorAll('.mock-panel-card');
    const panel0 = panels[0]?.cloneNode(true); // Smart Summaries
    const panel3 = panels[3]?.cloneNode(true); // Diagrams
    const panel1 = panels[1]?.cloneNode(true); // YouTube

    const overlay = document.createElement('div');
    overlay.id = 'tile-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 1400px; height: 560px;
      background: #06050e; z-index: 99999;
      display: flex; align-items: center; padding: 0 80px;
      overflow: hidden;
    `;

    // Background glows
    const g1 = document.createElement('div');
    g1.style.cssText = `
      position: absolute; top: 20%; left: 30%; width: 800px; height: 800px;
      background: radial-gradient(circle, rgba(79,70,229,0.1) 0%, transparent 55%);
      pointer-events: none;
    `;
    overlay.appendChild(g1);

    const g2 = document.createElement('div');
    g2.style.cssText = `
      position: absolute; bottom: -20%; right: 10%; width: 600px; height: 600px;
      background: radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 55%);
      pointer-events: none;
    `;
    overlay.appendChild(g2);

    // Left side: branding + tagline + badges
    const textDiv = document.createElement('div');
    textDiv.style.cssText = 'flex-shrink: 0; z-index: 1; max-width: 420px;';
    textDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
        <img src="/website/public/icon.svg" style="width:64px;height:64px;">
        <span style="font-family:'DM Sans',sans-serif;font-size:2.8rem;font-weight:700;color:#fff;letter-spacing:-0.02em;">xTil</span>
      </div>
      <div style="font-family:'DM Sans',sans-serif;font-size:1.8rem;font-weight:600;color:#fff;line-height:1.3;margin-bottom:16px;letter-spacing:-0.01em;">
        <span style="background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Extract</span> content,<br>
        <span style="background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">distill</span> knowledge
      </div>
      <div style="font-family:'Outfit',sans-serif;font-size:1.05rem;color:rgba(255,255,255,0.45);line-height:1.7;margin-bottom:24px;">
        AI-powered Chrome extension that turns any web page into structured insights — summaries, diagrams, fact-checks, and more.
      </div>
      ${badges}
    `;

    // Right side: 3 panels — YouTube center, Diagrams left, Summaries right
    const panelsDiv = document.createElement('div');
    panelsDiv.style.cssText = `
      flex: 1; z-index: 1; position: relative;
      display: flex; align-items: center; justify-content: center;
      gap: 20px; margin-left: 40px; height: 100%;
    `;

    function addFade(panel) {
      panel.style.position = 'relative';
      const fade = document.createElement('div');
      fade.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:50px;background:linear-gradient(transparent,#06050e);pointer-events:none;z-index:3;';
      panel.appendChild(fade);
    }

    // Left panel (Diagrams) — slight left tilt, scrolled to show the flowchart
    if (panel3) {
      panel3.style.cssText += `
        max-width: 260px; max-height: 460px; overflow: hidden; flex-shrink: 0;
        transform: rotate(-2.5deg) translateY(10px); opacity: 0.7;
      `;
      // Hide everything above the diagram — show from Summary section header + diagram onward
      const diaSections = panel3.querySelectorAll('.mock-panel-scroll > *');
      let foundDiagram = false;
      for (const el of diaSections) {
        if (el.querySelector('.mock-diagram') || el.classList.contains('mock-diagram')) {
          foundDiagram = true;
          break;
        }
        if (!foundDiagram) el.style.display = 'none';
      }
      addFade(panel3);
      // Add top fade since content is scrolled
      const topFade = document.createElement('div');
      topFade.style.cssText = 'position:absolute;top:0;left:0;right:0;height:40px;background:linear-gradient(#1a1c1e, transparent);pointer-events:none;z-index:3;';
      panel3.appendChild(topFade);
      panelsDiv.appendChild(panel3);
    }

    // Center panel (YouTube) — straight, larger, prominent
    if (panel1) {
      panel1.style.cssText += `
        max-width: 280px; max-height: 490px; overflow: hidden; flex-shrink: 0;
        transform: translateY(-8px) scale(1.02); z-index: 2;
        box-shadow: 0 12px 50px rgba(109,95,245,0.3), 0 0 0 1px rgba(255,255,255,0.1);
      `;
      addFade(panel1);
      panelsDiv.appendChild(panel1);
    }

    // Right panel (Summaries) — slight right tilt
    if (panel0) {
      panel0.style.cssText += `
        max-width: 260px; max-height: 460px; overflow: hidden; flex-shrink: 0;
        transform: rotate(2.5deg) translateY(10px); opacity: 0.7;
      `;
      addFade(panel0);
      panelsDiv.appendChild(panel0);
    }

    overlay.appendChild(textDiv);
    overlay.appendChild(panelsDiv);
    document.body.appendChild(overlay);
  }, marqueeBadges);

  await marqueePage.waitForTimeout(500);
  await marqueePage.screenshot({
    path: path.join(outputDir, 'promo-marquee-1400x560.png'),
    clip: { x: 0, y: 0, width: 1400, height: 560 },
  });
  console.log('  ✓ promo-marquee-1400x560.png');
  await marqueeCtx.close();

  await browser.close();
  console.log('\nDone! Promo tiles saved to website/public/store/');
}

main().catch(console.error);
