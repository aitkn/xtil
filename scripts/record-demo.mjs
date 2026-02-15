#!/usr/bin/env node
/**
 * Full CWS Screenshot Recording Script for xTil Chrome Extension.
 *
 * Automates the entire capture process across light and dark modes.
 * The only manual step: opening the side panel after Chrome launches.
 *
 * Usage:
 *   node scripts/record-demo.mjs
 *
 * Prerequisites:
 *   - Extension built: pnpm build
 *   - ImageMagick installed (for compositing)
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(ROOT, 'demo-output');
const CHROME_PROFILE = '/tmp/chrome-demo-profile';
const CDP_URL = 'http://[::1]:9222';

const CWS_WIDTH = 1280;
const CWS_HEIGHT = 800;
const PANEL_WIDTH = 420;

// ── Demo content ───────────────────────────────────────────────────
const DEMOS = {
  article: {
    url: 'https://www.paulgraham.com/greatwork.html',
    name: 'pg',
    label: 'Paul Graham — How to Do Great Work',
  },
  youtube: {
    url: 'https://www.youtube.com/watch?v=S9HdPi9Ikhk',
    name: 'yt',
    label: 'YouTube video',
  },
};

// ── Helpers ────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function out(name) {
  return path.join(OUTPUT_DIR, name);
}

const WAIT_FILE = path.join(OUTPUT_DIR, '.wait-signal');

/**
 * Pause and wait for user action. Prints a message and polls for
 * a signal file to be created (touch demo-output/.wait-signal).
 */
async function ask(question) {
  // Clean up any previous signal
  try { fs.unlinkSync(WAIT_FILE); } catch { /* ok */ }

  console.log(question);
  console.log('    ➡ Run: touch demo-output/.wait-signal   (when ready)');

  while (!fs.existsSync(WAIT_FILE)) {
    await sleep(1000);
  }
  try { fs.unlinkSync(WAIT_FILE); } catch { /* ok */ }
  console.log('    ✓ Continuing...\n');
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
  console.log(`    → ${path.basename(outputFile)}`);
}

async function findScrollable(page) {
  return page.evaluate(() => {
    let best = null;
    let bestHeight = 0;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        if (el.scrollHeight > bestHeight) {
          bestHeight = el.scrollHeight;
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

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('tldr-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await sleep(500);
}

// ── Chrome lifecycle ───────────────────────────────────────────────
function killChrome() {
  try {
    execSync('pkill -f chrome-demo-profile 2>/dev/null; exit 0', { timeout: 5000, shell: true });
  } catch { /* already dead */ }
}

function launchChrome(darkMode = false) {
  const darkFlag = darkMode ? '--force-dark-mode' : '';
  execSync(
    `nohup google-chrome --remote-debugging-port=9222 --user-data-dir=${CHROME_PROFILE} --window-size=1280,800 --force-device-scale-factor=1.5 ${darkFlag} > /dev/null 2>&1 &`,
    { shell: true },
  );
}

async function waitForChrome(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await fetch(`${CDP_URL}/json/version`);
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Chrome did not start in time');
}

async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  return { browser, context };
}

async function findPages(context) {
  // The side panel may have been opened after initial connect.
  // Re-query and wait briefly for new pages to register.
  let panelPage = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const pages = context.pages();
    panelPage = pages.find((p) => p.url().includes('sidepanel'));
    if (panelPage) {
      const webPage = pages.find((p) =>
        !p.url().startsWith('chrome-extension://') &&
        !p.url().startsWith('chrome://') &&
        !p.url().startsWith('about:'),
      );
      return { panelPage, webPage };
    }
    await sleep(1000);
  }
  const pages = context.pages();
  const webPage = pages.find((p) =>
    !p.url().startsWith('chrome-extension://') &&
    !p.url().startsWith('chrome://') &&
    !p.url().startsWith('about:'),
  );
  return { panelPage: null, webPage };
}

// ── Screenshot commands ────────────────────────────────────────────

async function captureWide(panelPage, webPage, name) {
  console.log(`  📸 Wide: ${name}-wide.png`);

  await findScrollable(panelPage);
  await scrollTo(panelPage, 0);

  const webFile = out(`${name}-web-tmp.png`);
  const panelFile = out(`${name}-panel-tmp.png`);

  await webPage.screenshot({ path: webFile });
  await panelPage.screenshot({ path: panelFile });

  const webWidth = CWS_WIDTH - PANEL_WIDTH - 2;
  compositeWithBackground(out(`${name}-wide.png`), '#f5f5f5', CWS_WIDTH, CWS_HEIGHT, [
    { file: webFile, x: 0, y: 0, width: webWidth, height: CWS_HEIGHT },
    { file: panelFile, x: webWidth + 2, y: 0, width: PANEL_WIDTH, height: CWS_HEIGHT },
  ]);

  fs.unlinkSync(webFile);
  fs.unlinkSync(panelFile);
}

async function captureContinuation(panelPage, name, theme) {
  const suffix = `continue-${theme}`;
  console.log(`  📸 Continuation (${theme}): ${name}-${suffix}.png`);

  await setTheme(panelPage, theme);
  const info = await findScrollable(panelPage);
  const maxScroll = Math.max(0, info.scrollHeight - info.clientHeight);
  const startScroll = info.clientHeight;
  const remaining = maxScroll - startScroll;

  const positions = remaining <= 0
    ? [startScroll, startScroll, startScroll]
    : [startScroll, Math.floor(startScroll + remaining / 2), maxScroll];

  console.log(`    Scroll: ${positions[0]} → ${positions[2]} (total: ${info.scrollHeight})`);

  const files = [];
  for (let i = 0; i < 3; i++) {
    await scrollTo(panelPage, positions[i]);
    const file = out(`${name}-${suffix}-${i}-tmp.png`);
    await panelPage.screenshot({ path: file });
    files.push(file);
  }

  const gap = 15;
  const panelW = Math.floor((CWS_WIDTH - gap * 4) / 3);
  const panelH = CWS_HEIGHT - gap * 2;
  const bgColor = theme === 'dark' ? '#1a1c1e' : '#f0f0f0';

  compositeWithBackground(out(`${name}-${suffix}.png`), bgColor, CWS_WIDTH, CWS_HEIGHT, [
    { file: files[0], x: gap, y: gap, width: panelW, height: panelH },
    { file: files[1], x: gap * 2 + panelW, y: gap, width: panelW, height: panelH },
    { file: files[2], x: gap * 3 + panelW * 2, y: gap, width: panelW, height: panelH },
  ]);

  for (const f of files) fs.unlinkSync(f);
  await scrollTo(panelPage, 0);
}

async function captureSettings(panelPage, name, theme) {
  console.log(`  📸 Settings (${theme}): ${name}-settings-${theme}.png`);

  await setTheme(panelPage, theme);

  // Navigate to settings by clicking the gear icon in the header
  try {
    // The settings gear is typically the last button/icon in the header
    const buttons = await panelPage.locator('header button, header svg').all();
    if (buttons.length > 0) {
      await buttons[buttons.length - 1].click();
      await sleep(1000);
    }
  } catch {
    console.log('    ⚠ Could not find settings button — please navigate manually');
    await ask('    Press Enter when settings view is open...');
  }

  const info = await findScrollable(panelPage);

  await scrollTo(panelPage, 0);
  const file1 = out(`${name}-settings-0-tmp.png`);
  await panelPage.screenshot({ path: file1 });

  await scrollTo(panelPage, Math.max(0, info.scrollHeight - info.clientHeight));
  const file2 = out(`${name}-settings-1-tmp.png`);
  await panelPage.screenshot({ path: file2 });

  const gap = 20;
  const panelW = Math.floor((CWS_WIDTH - gap * 3) / 2);
  const panelH = CWS_HEIGHT - gap * 2;
  const bgColor = theme === 'dark' ? '#1a1c1e' : '#f0f0f0';

  compositeWithBackground(out(`${name}-settings-${theme}.png`), bgColor, CWS_WIDTH, CWS_HEIGHT, [
    { file: file1, x: gap, y: gap, width: panelW, height: panelH },
    { file: file2, x: gap * 2 + panelW, y: gap, width: panelW, height: panelH },
  ]);

  fs.unlinkSync(file1);
  fs.unlinkSync(file2);
  await scrollTo(panelPage, 0);
}

async function navigateAndSummarize(panelPage, webPage, url, label) {
  console.log(`  🌐 Navigating to ${label}...`);
  await webPage.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // Wait for the panel to detect the new page (content indicators appear)
  console.log('  ⏳ Waiting for content detection...');
  await sleep(2000);

  // Click Summarize button
  console.log('  🔄 Clicking Summarize...');
  try {
    const summarizeBtn = panelPage.getByRole('button', { name: /summarize/i });
    await summarizeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await summarizeBtn.click();
  } catch {
    console.log('    ⚠ Could not find Summarize button');
    await ask('    Click Summarize manually and press Enter when summary is loaded...');
    return;
  }

  // Wait for summary to load (look for section headings)
  console.log('  ⏳ Waiting for summary (this may take a while)...');
  try {
    await panelPage.waitForFunction(
      () => {
        const text = document.body?.textContent || '';
        return text.includes('Key Takeaways') || text.includes('Notable Quotes') || text.includes('Summary');
      },
      { timeout: 180000 },
    );
    await sleep(2000); // let rendering settle
    console.log('  ✅ Summary loaded');
  } catch {
    console.log('    ⚠ Timed out waiting for summary');
    await ask('    Press Enter when summary is visible...');
  }
}

// ── Main orchestration ─────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║  xTil CWS Screenshot Recording Script    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Session 1: Light Mode ──────────────────────────────────────
  console.log('━━━ SESSION 1: LIGHT MODE ━━━\n');

  killChrome();
  await sleep(2000);
  console.log('Launching Chrome (light mode)...');
  launchChrome(false);
  await waitForChrome();
  console.log('Chrome is up.\n');

  // Connect and navigate to first page before asking for side panel
  let { browser, context } = await connect();
  let { panelPage, webPage } = await findPages(context);

  if (!webPage) {
    webPage = await context.newPage();
  }

  console.log(`  🌐 Navigating to ${DEMOS.article.label}...`);
  await webPage.goto(DEMOS.article.url, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  await ask('👉 Open the xTil side panel, then press Enter...');

  // Reconnect to pick up the newly opened side panel page
  await browser.close();
  ({ browser, context } = await connect());
  ({ panelPage, webPage } = await findPages(context));
  if (!panelPage) {
    console.error('Side panel not found!');
    await browser.close();
    process.exit(1);
  }

  // Article — light mode: panel should already detect the page
  console.log('  ⏳ Waiting for content detection...');
  await sleep(3000);

  console.log('  🔄 Clicking Summarize...');
  try {
    const summarizeBtn = panelPage.getByRole('button', { name: /summarize/i });
    await summarizeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await summarizeBtn.click();
  } catch {
    await ask('    Click Summarize manually and press Enter when summary is loaded...');
  }

  console.log('  ⏳ Waiting for summary...');
  try {
    await panelPage.waitForFunction(
      () => {
        const text = document.body?.textContent || '';
        return text.includes('Key Takeaways') || text.includes('Notable Quotes') || text.includes('Summary');
      },
      { timeout: 180000 },
    );
    await sleep(2000);
    console.log('  ✅ Summary loaded');
  } catch {
    await ask('    Press Enter when summary is visible...');
  }
  await setTheme(panelPage, 'light');
  await captureWide(panelPage, webPage, DEMOS.article.name);
  await captureContinuation(panelPage, DEMOS.article.name, 'light');

  // YouTube — light mode
  await navigateAndSummarize(panelPage, webPage, DEMOS.youtube.url, DEMOS.youtube.label);
  await setTheme(panelPage, 'light');
  await captureWide(panelPage, webPage, DEMOS.youtube.name);
  await captureContinuation(panelPage, DEMOS.youtube.name, 'light');

  // Settings — light mode
  await captureSettings(panelPage, 'ext', 'light');

  // Navigate back to summary view for next session
  try {
    const backBtn = panelPage.locator('header button').first();
    await backBtn.click();
    await sleep(500);
  } catch { /* ignore */ }

  await browser.close();

  // ── Session 2: Dark Mode ───────────────────────────────────────
  console.log('\n━━━ SESSION 2: DARK MODE ━━━\n');

  killChrome();
  await sleep(2000);
  console.log('Launching Chrome (dark mode)...');
  launchChrome(true);
  await waitForChrome();
  console.log('Chrome is up.\n');

  ({ browser, context } = await connect());
  ({ panelPage, webPage } = await findPages(context));

  if (!webPage) {
    webPage = await context.newPage();
  }

  console.log(`  🌐 Navigating to ${DEMOS.article.label}...`);
  await webPage.goto(DEMOS.article.url, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  await ask('👉 Open the xTil side panel, then press Enter...');

  // Reconnect to pick up the newly opened side panel page
  await browser.close();
  ({ browser, context } = await connect());
  ({ panelPage, webPage } = await findPages(context));
  if (!panelPage) {
    console.error('Side panel not found!');
    await browser.close();
    process.exit(1);
  }

  // Article — dark mode
  console.log('  ⏳ Waiting for content detection...');
  await sleep(3000);

  console.log('  🔄 Clicking Summarize...');
  try {
    const summarizeBtn = panelPage.getByRole('button', { name: /summarize/i });
    await summarizeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await summarizeBtn.click();
  } catch {
    await ask('    Click Summarize manually and press Enter when summary is loaded...');
  }

  console.log('  ⏳ Waiting for summary...');
  try {
    await panelPage.waitForFunction(
      () => {
        const text = document.body?.textContent || '';
        return text.includes('Key Takeaways') || text.includes('Notable Quotes') || text.includes('Summary');
      },
      { timeout: 180000 },
    );
    await sleep(2000);
    console.log('  ✅ Summary loaded');
  } catch {
    await ask('    Press Enter when summary is visible...');
  }
  await setTheme(panelPage, 'dark');
  await captureWide(panelPage, webPage, `${DEMOS.article.name}-dark`);
  await captureContinuation(panelPage, `${DEMOS.article.name}-dark`, 'dark');

  // YouTube — dark mode
  await navigateAndSummarize(panelPage, webPage, DEMOS.youtube.url, DEMOS.youtube.label);
  await setTheme(panelPage, 'dark');
  await captureWide(panelPage, webPage, `${DEMOS.youtube.name}-dark`);
  await captureContinuation(panelPage, `${DEMOS.youtube.name}-dark`, 'dark');

  // Settings — dark mode
  await captureSettings(panelPage, 'ext', 'dark');

  await browser.close();

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  ✅ All screenshots captured!            ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('Output files:');
  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.png') && !f.includes('tmp'));
  for (const f of files.sort()) {
    console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
