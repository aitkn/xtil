import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '..', 'website', 'public', 'store');

// Platform SVG icons (monochrome white, used in slides 1 and 5)
const PLATFORM_ICONS = {
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  reddit: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  gdocs: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zm-.545 10.455H7.09v-1.455h7.09v1.455zm2.727-3.273H7.091v-1.454h9.818v1.454zm0-3.272H7.091V9.182h9.818v1.455zM14.727 0l6 6h-6V0z"/></svg>`,
  notion: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.25 2.07c-.419-.373-.93-.606-1.96-.513l-12.8.93c-.465.046-.558.28-.372.466zm.793 3.126v13.938c0 .746.373 1.026 1.213.98l14.523-.84c.84-.046.932-.559.932-1.166V6.474c0-.606-.233-.886-.745-.84l-15.178.886c-.559.047-.745.28-.745.793zm14.337.699c.093.42 0 .839-.42.886l-.698.14v10.264c-.607.326-1.166.512-1.632.512-.745 0-.933-.233-1.492-.932l-4.572-7.186v6.952l1.446.326s0 .84-1.166.84l-3.22.186c-.092-.186 0-.653.326-.746l.84-.233V9.854L7.822 9.76c-.093-.42.14-1.026.793-1.073l3.453-.233 4.758 7.279V9.294l-1.213-.14c-.093-.512.28-.886.746-.932zM1.18 1.674L14.43.69c1.632-.14 2.054-.046 3.08.699l4.245 2.986c.698.512.932.652.932 1.212v16.379c0 1.026-.373 1.632-1.679 1.726l-15.458.932c-.979.047-1.445-.093-1.958-.746L1.124 20.61c-.559-.746-.793-1.306-.793-1.958V3.307c0-.84.373-1.539 1.352-1.633z"/></svg>`,
  markdown: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M22.27 19.385H1.73A1.73 1.73 0 010 17.655V6.345a1.73 1.73 0 011.73-1.73h20.54A1.73 1.73 0 0124 6.345v11.308a1.73 1.73 0 01-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885 2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885-2.308-2.885H3.461v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z"/></svg>`,
  pdf: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`,
  html: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
};

const SLIDES = [
  {
    name: 'smart-summaries',
    panelIndex: 0,
    icon: '&#9889;',
    iconBg: 'rgba(251,191,36,0.12)',
    iconColor: '#fbbf24',
    title: 'Any Page,<br>Fully Analyzed',
    desc: 'Works on any readable web page. YouTube, GitHub, Reddit, X, and others get custom extractors with platform-specific sections. Everything else is analyzed just as deeply.',
    badges: ['youtube', 'github', 'reddit', 'x', 'facebook', 'gdocs'],
  },
  {
    name: 'youtube-analysis',
    panelIndex: 1,
    icon: '&#9654;',
    iconBg: 'rgba(239,68,68,0.12)',
    iconColor: '#f87171',
    title: 'YouTube Videos,<br>Decoded',
    desc: 'Transcripts turned into structured summaries with clickable timestamps. Comments extracted and analyzed. Channel stats and engagement data alongside.',
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
    name: 'export-share',
    panelIndex: -1, // custom layout, no panel clone
    icon: '&#128640;',
    iconBg: 'rgba(74,222,128,0.12)',
    iconColor: '#4ade80',
    title: 'Export &<br>Share Anywhere',
    desc: 'One-click export to Notion (shareable link), Markdown file, rich HTML clipboard, Google Docs paste, or Print/PDF. Your insights go wherever you need them.',
    exports: [
      { icon: 'notion', label: 'Notion', sub: 'Shareable link' },
      { icon: 'markdown', label: 'Markdown', sub: '.md download' },
      { icon: 'html', label: 'Clipboard', sub: 'Rich HTML / MD' },
      { icon: 'gdocs', label: 'Google Docs', sub: 'Paste formatted' },
      { icon: 'pdf', label: 'Print / PDF', sub: 'Browser dialog' },
    ],
  },
];

function createBaseOverlay() {
  return `
    position: fixed; top: 0; left: 0; width: 1280px; height: 800px;
    background: linear-gradient(135deg, #08070f 0%, #0e0d1a 30%, #110f20 60%, #0a0918 100%);
    z-index: 99999; overflow: hidden;
  `;
}

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
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    document.querySelectorAll('img[src="/icon.svg"]').forEach(img => {
      img.src = '/website/public/icon.svg';
    });
  });
  await page.waitForTimeout(500);

  // Pass platform icons and slides data to the page
  const platformIcons = PLATFORM_ICONS;

  for (const slide of SLIDES) {
    console.log(`Generating ${slide.name}...`);

    await page.evaluate(({ s, icons }) => {
      const overlay = document.createElement('div');
      overlay.id = 'screenshot-overlay';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 1280px; height: 800px;
        background: linear-gradient(135deg, #08070f 0%, #0e0d1a 30%, #110f20 60%, #0a0918 100%);
        z-index: 99999; display: flex; align-items: center; padding: 0 60px; gap: 40px;
        overflow: hidden;
      `;

      // Background glows
      const glow1 = document.createElement('div');
      glow1.style.cssText = `
        position: absolute; top: 30%; right: 15%; width: 800px; height: 800px;
        background: radial-gradient(circle, rgba(109,95,245,0.15) 0%, transparent 60%);
        transform: translate(30%, -40%); pointer-events: none;
      `;
      overlay.appendChild(glow1);

      const glow2 = document.createElement('div');
      glow2.style.cssText = `
        position: absolute; bottom: -15%; left: 5%; width: 600px; height: 600px;
        background: radial-gradient(circle, rgba(79,70,229,0.1) 0%, transparent 60%);
        pointer-events: none;
      `;
      overlay.appendChild(glow2);

      const glow3 = document.createElement('div');
      glow3.style.cssText = `
        position: absolute; top: -20%; left: 40%; width: 500px; height: 500px;
        background: radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 55%);
        pointer-events: none;
      `;
      overlay.appendChild(glow3);

      // Brand top-left
      const brand = document.createElement('div');
      brand.style.cssText = `
        position: absolute; top: 32px; left: 60px;
        display: flex; align-items: center; gap: 10px; opacity: 0.5;
      `;
      brand.innerHTML = `
        <img src="/website/public/icon.svg" style="width:48px;height:48px;">
        <span style="font-family:'DM Sans',sans-serif;font-size:1.8rem;font-weight:700;color:#fff;">xTil</span>
      `;
      overlay.appendChild(brand);

      // URL bottom-left
      const url = document.createElement('div');
      url.style.cssText = `
        position: absolute; bottom: 32px; left: 60px;
        font-family: 'Outfit', sans-serif; font-size: 1.4rem;
        color: rgba(255,255,255,0.3); letter-spacing: 0.03em;
      `;
      url.textContent = 'xtil.ai';
      overlay.appendChild(url);

      // Text side
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'flex: 1; max-width: 540px; z-index: 1;';

      let badgesHTML = '';
      if (s.badges) {
        badgesHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:28px;">
          ${s.badges.map(key => `<div style="display:flex;align-items:center;gap:7px;padding:6px 14px;border-radius:10px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);font-family:'Outfit',sans-serif;font-size:0.95rem;font-weight:500;">${icons[key]}<span>${key === 'x' ? 'X / Twitter' : key === 'gdocs' ? 'Google Docs' : key.charAt(0).toUpperCase() + key.slice(1)}</span></div>`).join('')}
        </div>`;
      }

      textDiv.innerHTML = `
        <div style="width:72px;height:72px;border-radius:18px;background:${s.iconBg};color:${s.iconColor};
          display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin-bottom:36px;">${s.icon}</div>
        <div style="font-size:3.8rem;font-weight:700;color:#fff;line-height:1.08;margin-bottom:28px;
          font-family:'DM Sans',sans-serif;letter-spacing:-0.02em;">${s.title}</div>
        <div style="font-size:1.7rem;color:rgba(255,255,255,0.5);line-height:1.65;
          font-family:'Outfit',sans-serif;font-weight:400;">${s.desc}</div>
        ${badgesHTML}
      `;
      overlay.appendChild(textDiv);

      // Right side — panel or custom export layout
      if (s.panelIndex >= 0) {
        // Standard panel slide
        const panels = document.querySelectorAll('.mock-panel-card');
        const panel = panels[s.panelIndex];
        if (panel) {
          const panelClone = panel.cloneNode(true);
          const panelWrapper = document.createElement('div');
          panelWrapper.style.cssText = `
            flex-shrink: 0; z-index: 1; position: relative;
            max-height: 740px; overflow: hidden;
          `;
          panelClone.style.maxWidth = '520px';
          panelClone.style.minWidth = '480px';
          panelClone.style.maxHeight = 'none';
          panelClone.style.zoom = '1.2';
          panelWrapper.appendChild(panelClone);

          const fade = document.createElement('div');
          fade.style.cssText = `
            position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
            background: linear-gradient(transparent, #08070f);
            pointer-events: none;
          `;
          panelWrapper.appendChild(fade);
          overlay.appendChild(panelWrapper);
        }
      } else if (s.exports) {
        // Export slide — custom grid of export cards
        const exportDiv = document.createElement('div');
        exportDiv.style.cssText = `
          flex-shrink: 0; z-index: 1; display: flex; flex-direction: column;
          gap: 16px; width: 480px;
        `;

        for (const exp of s.exports) {
          const card = document.createElement('div');
          card.style.cssText = `
            display: flex; align-items: center; gap: 20px;
            padding: 22px 28px; border-radius: 16px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            transition: all 0.2s;
          `;
          card.innerHTML = `
            <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,0.06);
              display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);flex-shrink:0;">
              ${icons[exp.icon]}
            </div>
            <div>
              <div style="font-family:'DM Sans',sans-serif;font-size:1.35rem;font-weight:600;color:#fff;margin-bottom:4px;">${exp.label}</div>
              <div style="font-family:'Outfit',sans-serif;font-size:1rem;color:rgba(255,255,255,0.4);">${exp.sub}</div>
            </div>
          `;
          exportDiv.appendChild(card);
        }

        overlay.appendChild(exportDiv);
      }

      document.body.appendChild(overlay);
    }, { s: slide, icons: platformIcons });

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
