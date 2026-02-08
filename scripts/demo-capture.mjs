#!/usr/bin/env node
/**
 * Connect to Chrome and capture screenshots.
 *
 * Usage:
 *   node scripts/demo-capture.mjs <name> [--dark] [--no-wide]
 *
 * Examples:
 *   node scripts/demo-capture.mjs pg
 *   node scripts/demo-capture.mjs yt --dark
 *   node scripts/demo-capture.mjs settings --no-wide
 *
 * Outputs to demo-output/:
 *   <name>-wide.png           — webpage + panel side-by-side (1280x800)
 *   <name>-continue.png       — 3 narrow panel scrolls (1280x800)
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'demo-output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const CWS_WIDTH = 1280;
const CWS_HEIGHT = 800;
const PANEL_WIDTH = 420;

// ── Parse args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const NAME = args.find((a) => !a.startsWith('--')) || 'shot';
const dark = args.includes('--dark');
const noWide = args.includes('--no-wide');
const scrollsArg = args.find((a) => a.startsWith('--scrolls='));
const NUM_SCROLLS = scrollsArg ? parseInt(scrollsArg.split('=')[1], 10) : 3;
const theme = dark ? 'dark' : 'light';

// ── Helpers ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (name) => path.join(OUTPUT_DIR, name);

/** Capture screenshot via raw CDP WebSocket — no tab activation */
async function cdpScreenshot(debuggerUrl, filePath) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(debuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.id === 1) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else {
          fs.writeFileSync(filePath, Buffer.from(msg.result.data, 'base64'));
          resolve();
        }
      }
    };
    ws.onerror = reject;
  });
}

function compositeWithBackground(outputFile, bgColor, width, height, overlays) {
  let cmd = `convert -size ${width}x${height} xc:"${bgColor}"`;
  for (const o of overlays) {
    if (o.width && o.height) {
      cmd += ` \\( "${o.file}" -resize ${o.width}x${o.height}! \\) -geometry +${o.x}+${o.y} -composite`;
    } else {
      cmd += ` "${o.file}" -geometry +${o.x}+${o.y} -composite`;
    }
  }
  cmd += ` "${outputFile}"`;
  execSync(cmd);
}

async function findScrollable(page) {
  return page.evaluate(() => {
    // Remove previous marker
    document.querySelectorAll('[data-demo-scroll]').forEach((el) => el.removeAttribute('data-demo-scroll'));

    // Find all scrollable elements, prefer the topmost visible one (highest z-index / later in DOM)
    let best = null;
    let bestZ = -Infinity;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        // Skip hidden elements
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.offsetParent === null) continue;
        const z = parseInt(cs.zIndex, 10) || 0;
        // Prefer higher z-index; on tie, later DOM element wins (overlay on top of content)
        if (z >= bestZ) {
          bestZ = z;
          best = el;
        }
      }
    }
    if (best) {
      best.setAttribute('data-demo-scroll', 'true');
      return { scrollHeight: best.scrollHeight, clientHeight: best.clientHeight };
    }
    return { scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight };
  });
}

async function scrollTo(page, y) {
  await page.evaluate((scrollY) => {
    const container = document.querySelector('[data-demo-scroll]') || document.documentElement;
    container.scrollTop = scrollY;
  }, y);
  await sleep(300);
}

// ── Main ───────────────────────────────────────────────────────────
const browser = await chromium.connectOverCDP('http://[::1]:9222');
const context = browser.contexts()[0];
const pages = context.pages();

const panelPage = pages.find((p) => p.url().includes('sidepanel'));
const webPage = pages.find((p) =>
  !p.url().startsWith('chrome-extension://') &&
  !p.url().startsWith('chrome://') &&
  !p.url().startsWith('about:'),
);

if (!panelPage) {
  console.error('Side panel not found.');
  await browser.close();
  process.exit(1);
}

// Set theme
await panelPage.evaluate((t) => {
  localStorage.setItem('tldr-theme', t);
  document.documentElement.setAttribute('data-theme', t);
}, theme);
await sleep(500);

// ── Wide screenshot ────────────────────────────────────────────────
if (!noWide && webPage) {
  console.log(`Wide: ${NAME}-wide.png`);
  await findScrollable(panelPage);
  await scrollTo(panelPage, 0);

  const webFile = out(`_tmp-web.png`);
  const panelFile = out(`_tmp-panel.png`);

  // Screenshot web page via raw CDP WebSocket (no tab activation)
  const targets = await (await fetch('http://[::1]:9222/json/list')).json();
  const webTarget = targets.find((t) =>
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('about:') &&
    t.webSocketDebuggerUrl,
  );
  if (webTarget) {
    await cdpScreenshot(webTarget.webSocketDebuggerUrl, webFile);
  } else {
    await webPage.screenshot({ path: webFile });
  }

  await panelPage.screenshot({ path: panelFile });

  const webWidth = CWS_WIDTH - PANEL_WIDTH - 2;
  const bgColor = dark ? '#1a1c1e' : '#f5f5f5';
  compositeWithBackground(out(`${NAME}-wide.png`), bgColor, CWS_WIDTH, CWS_HEIGHT, [
    { file: webFile, x: 0, y: 0, width: webWidth, height: CWS_HEIGHT },
    { file: panelFile, x: webWidth + 2, y: 0, width: PANEL_WIDTH, height: CWS_HEIGHT },
  ]);
  fs.unlinkSync(webFile);
  fs.unlinkSync(panelFile);
}

// ── Continuation (N narrow scrolls) ──────────────────────────────
console.log(`Continue: ${NAME}-continue.png (${NUM_SCROLLS} panels)`);
const info = await findScrollable(panelPage);
const maxScroll = Math.max(0, info.scrollHeight - info.clientHeight);

const positions = [];
for (let i = 0; i < NUM_SCROLLS; i++) {
  positions.push(Math.floor((maxScroll * i) / Math.max(1, NUM_SCROLLS - 1)));
}

console.log(`  Scroll: ${positions[0]} → ${positions[NUM_SCROLLS - 1]} (height: ${info.scrollHeight}, viewport: ${info.clientHeight})`);

const files = [];
for (let i = 0; i < NUM_SCROLLS; i++) {
  await scrollTo(panelPage, positions[i]);
  const file = out(`_tmp-scroll-${i}.png`);
  await panelPage.screenshot({ path: file });
  files.push(file);
}

const gap = 15;
const panelW = Math.floor((CWS_WIDTH - gap * (NUM_SCROLLS + 1)) / NUM_SCROLLS);
const panelH = CWS_HEIGHT - gap * 2;
const bgColor = dark ? '#1a1c1e' : '#f0f0f0';

const overlays = files.map((file, i) => ({
  file, x: gap * (i + 1) + panelW * i, y: gap, width: panelW, height: panelH,
}));
compositeWithBackground(out(`${NAME}-continue.png`), bgColor, CWS_WIDTH, CWS_HEIGHT, overlays);
for (const f of files) fs.unlinkSync(f);

await scrollTo(panelPage, 0);
await browser.close();
console.log('Done.');
