import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '..', 'website', 'public', 'store');

const SLIDES = [
  {
    name: 'smart-summaries',
    panelIndex: 0,
    icon: '&#9889;',
    iconBg: 'rgba(251,191,36,0.12)',
    iconColor: '#fbbf24',
    title: 'Smart Multi-Section<br>Summaries',
    desc: 'Every page gets a full breakdown — overview, key takeaways with bold labels, fact-checks that grade claims as verified or contested, notable quotes, and a conclusion.',
  },
  {
    name: 'youtube-analysis',
    panelIndex: 1,
    icon: '&#9654;',
    iconBg: 'rgba(239,68,68,0.12)',
    iconColor: '#f87171',
    title: 'YouTube Videos,<br>Decoded',
    desc: 'Full video transcripts turned into structured summaries. Clickable timestamps jump to the exact moment. Channel, duration, and engagement stats displayed alongside.',
  },
  {
    name: 'chat-refinement',
    panelIndex: 2,
    icon: '&#128488;',
    iconBg: 'rgba(251,191,36,0.12)',
    iconColor: '#fbbf24',
    title: 'Refine with<br>Conversation',
    desc: 'Translate everything, expand a section, or add entirely new ones like Timeline or Key Statistics. Every message has a revert button — one click rolls back.',
  },
  {
    name: 'auto-diagrams',
    panelIndex: 3,
    icon: '&#128200;',
    iconBg: 'rgba(109,95,245,0.12)',
    iconColor: '#8b7cf6',
    title: 'Diagrams,<br>Automatically',
    desc: 'Flowcharts, class diagrams, timelines, ER diagrams — over 20 types. Syntax errors get auto-fixed. If a diagram has issues, xTil retries up to 5 times.',
  },
  {
    name: 'github-analysis',
    panelIndex: 4,
    icon: '&#128736;',
    iconBg: 'rgba(255,255,255,0.08)',
    iconColor: '#e8e5f5',
    title: 'GitHub PRs,<br>Deep-Analyzed',
    desc: 'Merge-readiness status, auto-generated class diagrams, issues linked to specific lines. Six modes for PRs, issues, code, repos, commits, and releases.',
  },
];

async function main() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto('http://localhost:8124/website/public/index.html');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // fonts

  // Fix icon paths for local server (localhost serves from project root, not website/public)
  await page.evaluate(() => {
    document.querySelectorAll('img[src="/icon.svg"]').forEach(img => {
      img.src = '/website/public/icon.svg';
    });
  });
  await page.waitForTimeout(500);

  for (const slide of SLIDES) {
    console.log(`Generating ${slide.name}...`);

    await page.evaluate((s) => {
      const panels = document.querySelectorAll('.mock-panel-card');
      const panel = panels[s.panelIndex];
      if (!panel) { console.error('Panel not found:', s.panelIndex); return; }
      const panelClone = panel.cloneNode(true);

      // Create overlay
      const overlay = document.createElement('div');
      overlay.id = 'screenshot-overlay';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 1280px; height: 800px;
        background: #06050e; z-index: 99999;
        display: flex; align-items: center; padding: 0 80px; gap: 50px;
        overflow: hidden;
      `;

      // Background glow
      const glow1 = document.createElement('div');
      glow1.style.cssText = `
        position: absolute; top: 40%; right: 20%; width: 700px; height: 700px;
        background: radial-gradient(circle, rgba(109,95,245,0.1) 0%, transparent 65%);
        transform: translate(50%, -50%); pointer-events: none;
      `;
      overlay.appendChild(glow1);

      const glow2 = document.createElement('div');
      glow2.style.cssText = `
        position: absolute; bottom: -10%; left: 10%; width: 500px; height: 500px;
        background: radial-gradient(circle, rgba(79,70,229,0.06) 0%, transparent 65%);
        pointer-events: none;
      `;
      overlay.appendChild(glow2);

      // Brand top-left
      const brand = document.createElement('div');
      brand.style.cssText = `
        position: absolute; top: 28px; left: 40px;
        display: flex; align-items: center; gap: 8px; opacity: 0.4;
      `;
      brand.innerHTML = `
        <img src="/website/public/icon.svg" style="width:22px;height:22px;">
        <span style="font-family:'DM Sans',sans-serif;font-size:0.95rem;font-weight:700;color:#fff;">xTil</span>
      `;
      overlay.appendChild(brand);

      // URL bottom-left
      const url = document.createElement('div');
      url.style.cssText = `
        position: absolute; bottom: 28px; left: 40px;
        font-family: 'Outfit', sans-serif; font-size: 0.85rem;
        color: rgba(255,255,255,0.25); letter-spacing: 0.03em;
      `;
      url.textContent = 'xtil.ai';
      overlay.appendChild(url);

      // Text side
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'flex: 1; max-width: 440px; z-index: 1;';
      textDiv.innerHTML = `
        <div style="width:52px;height:52px;border-radius:14px;background:${s.iconBg};color:${s.iconColor};
          display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:28px;">${s.icon}</div>
        <div style="font-size:2.8rem;font-weight:700;color:#fff;line-height:1.12;margin-bottom:20px;
          font-family:'DM Sans',sans-serif;letter-spacing:-0.02em;">${s.title}</div>
        <div style="font-size:1.1rem;color:rgba(255,255,255,0.5);line-height:1.8;
          font-family:'Outfit',sans-serif;font-weight:400;">${s.desc}</div>
      `;

      // Panel side — clip to fit height
      const panelWrapper = document.createElement('div');
      panelWrapper.style.cssText = `
        flex-shrink: 0; z-index: 1; position: relative;
        max-height: 720px; overflow: hidden;
      `;
      panelClone.style.maxWidth = '420px';
      panelClone.style.maxHeight = 'none';
      panelWrapper.appendChild(panelClone);

      // Fade-out gradient at bottom if clipped
      const fade = document.createElement('div');
      fade.style.cssText = `
        position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
        background: linear-gradient(transparent, #06050e);
        pointer-events: none;
      `;
      panelWrapper.appendChild(fade);

      overlay.appendChild(textDiv);
      overlay.appendChild(panelWrapper);
      document.body.appendChild(overlay);
    }, slide);

    await page.waitForTimeout(300);

    await page.screenshot({
      path: path.join(outputDir, `${slide.name}.png`),
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });

    await page.evaluate(() => {
      document.getElementById('screenshot-overlay')?.remove();
    });

    console.log(`  ✓ ${slide.name}.png`);
  }

  await browser.close();
  console.log(`\nDone! ${SLIDES.length} screenshots saved to website/public/store/`);
}

main().catch(console.error);
