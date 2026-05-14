/**
 * start-chrome.js
 *
 * Opens a real Chrome window with remote-debugging enabled on port 9222.
 * browser-server.js will then CONNECT to this Chrome instead of launching
 * a new automated one — so ChatGPT sees a genuine browser with no bot flags.
 *
 * Run ONCE before starting browser-server.js:
 *   node start-chrome.js
 *
 * Login to ChatGPT in the window that opens (session is saved for next time).
 * Then open a second terminal and run: node browser-server.js
 */

'use strict';

const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const http         = require('http');

const DEBUG_PORT   = 9222;
const PROFILE_DIR  = path.join(__dirname, '.chatgpt-profile');
const CHATGPT_URL  = 'https://chatgpt.com';

// ── Find Chrome executable ────────────────────────────────────────────────────
const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
};

function findChrome() {
  // Allow override via env var
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = CHROME_CANDIDATES[os.platform()] || [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Check if remote-debugging port is already active ─────────────────────────
function isDebugPortOpen() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${DEBUG_PORT}/json/version`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const alreadyOpen = await isDebugPortOpen();
  if (alreadyOpen) {
    console.log(`\n✓  Chrome is already running with remote-debugging on port ${DEBUG_PORT}.`);
    console.log(`   You can start browser-server.js now.\n`);
    return;
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('\n✗  Could not find Chrome/Chromium.');
    console.error('   Set the CHROME_PATH environment variable to your Chrome executable.\n');
    process.exit(1);
  }

  // Ensure profile directory exists
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    // Do NOT pass --no-sandbox or any automation flags
    CHATGPT_URL,
  ];

  console.log(`\n▶  Launching Chrome with remote-debugging (port ${DEBUG_PORT})…`);
  console.log(`   Executable: ${chromePath}`);
  console.log(`   Profile:    ${PROFILE_DIR}`);
  console.log(`\n   → If this is your first run, log in to ChatGPT in the window.`);
  console.log(`   → Your session will be saved for future runs.`);
  console.log(`   → Then start browser-server.js in a separate terminal.\n`);

  const proc = spawn(chromePath, args, {
    detached: false,
    stdio:    'ignore',
  });

  proc.on('error', (err) => {
    console.error('✗  Failed to start Chrome:', err.message);
    process.exit(1);
  });

  proc.on('exit', (code) => {
    console.log(`\n   Chrome exited (code ${code}).`);
    process.exit(0);
  });

  // Keep this process alive so Ctrl+C closes Chrome cleanly
  process.on('SIGINT', () => {
    console.log('\n   Closing Chrome…');
    proc.kill();
    process.exit(0);
  });
}

main();
