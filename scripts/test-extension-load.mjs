#!/usr/bin/env node
/**
 * PoC: Connect Playwright to a running Chrome instance and interact
 * with the TL;DR side panel.
 *
 * Usage:
 *   1. Start Chrome with remote debugging:
 *      google-chrome --remote-debugging-port=9222
 *   2. Install/load the extension manually (or it's already installed)
 *   3. Open a web page and open the side panel
 *   4. Run: node scripts/test-extension-load.mjs
 *
 * This approach gives Playwright full access to the side panel page.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'demo-output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const CDP_URL = process.argv[2] || 'http://[::1]:9222';

console.log(`Connecting to Chrome at ${CDP_URL}...`);
const browser = await chromium.connectOverCDP(CDP_URL);
const contexts = browser.contexts();
console.log(`Found ${contexts.length} browser context(s)`);

const context = contexts[0];
const pages = context.pages();
console.log(`\nAll pages (${pages.length}):`);
for (const p of pages) {
  console.log(`  - ${p.url()}`);
}

// Find the side panel page
const panelPage = pages.find((p) => p.url().includes('sidepanel'));
if (!panelPage) {
  console.error('\nSide panel not found. Make sure the TL;DR side panel is open in Chrome.');
  console.error('Click the TL;DR icon in the toolbar to open it.');
  await browser.close();
  process.exit(1);
}

console.log(`\nSide panel found: ${panelPage.url()}`);

// Take a screenshot of the side panel
await panelPage.screenshot({ path: path.join(OUTPUT_DIR, 'sidepanel-poc.png') });
console.log('Screenshot saved to demo-output/sidepanel-poc.png');

// List visible elements
const bodyText = await panelPage.textContent('body');
console.log('\nPanel content (first 300 chars):');
console.log(bodyText?.slice(0, 300));

await browser.close();
console.log('\nDone!');
