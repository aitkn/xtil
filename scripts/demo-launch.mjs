#!/usr/bin/env node
/**
 * Launch Chrome with a specific theme and navigate to a URL.
 *
 * Usage:
 *   node scripts/demo-launch.mjs <url> [--dark]
 *
 * Examples:
 *   node scripts/demo-launch.mjs https://www.paulgraham.com/greatwork.html
 *   node scripts/demo-launch.mjs https://www.youtube.com/watch?v=S9HdPi9Ikhk --dark
 */
import { execSync } from 'child_process';

const PROFILE = '/tmp/chrome-demo-profile';
const args = process.argv.slice(2);
const dark = args.includes('--dark');
const url = args.find((a) => !a.startsWith('--')) || 'about:blank';

// Kill existing Chrome
try { execSync('pkill -f chrome-demo-profile; sleep 1; exit 0', { shell: true, timeout: 5000 }); } catch {}

const darkFlag = dark ? '--force-dark-mode' : '';
const cmd = `nohup google-chrome --remote-debugging-port=9222 --user-data-dir=${PROFILE} --window-size=1280,800 --force-device-scale-factor=1.5 ${darkFlag} "${url}" > /dev/null 2>&1 &`;
execSync(cmd, { shell: true });

console.log(`Chrome launched (${dark ? 'dark' : 'light'} mode)`);
console.log(`URL: ${url}`);
console.log('Now open the TL;DR side panel.');
