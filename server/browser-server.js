/**
 * browser-server.js  –  Port 3001
 *
 * ANTI-BOT STRATEGY (three layers):
 *
 * Layer 1 — Connect to real Chrome (best)
 *   If start-chrome.js is running, this server connects to that real browser
 *   instead of launching a new one.  Real Chrome = no navigator.webdriver flag,
 *   real plugin list, real history — completely undetectable.
 *
 * Layer 2 — Stealth fallback (if no real Chrome is available)
 *   Launches Puppeteer's bundled Chrome with manual stealth patches applied
 *   before the page loads: removes navigator.webdriver, fakes plugins, patches
 *   window.chrome and the Permissions API, scrubs CDP automation artifacts.
 *
 * Layer 3 — Human-like interactions (always active)
 *   Every click is preceded by natural bezier-curve mouse movement.
 *   Text is pasted via the clipboard instead of character-by-character typing.
 *   All delays are randomised around realistic human latencies.
 *
 * How to start:
 *   Recommended:  node start-chrome.js   (in terminal 1, keep it running)
 *                 node browser-server.js  (in terminal 2)
 *   Fallback:     node browser-server.js  (alone — uses stealth launch)
 */

'use strict';

const express   = require('express');
const puppeteer = require('puppeteer');
const path      = require('path');
const http      = require('http');

const PORT        = 3001;
const DEBUG_PORT  = 9222;   // port start-chrome.js uses
const CHATGPT_URL = 'https://chatgpt.com';
const PROFILE_DIR = path.join(__dirname, '.chatgpt-profile');

// ── State ─────────────────────────────────────────────────────────────────────
let browser    = null;
let page       = null;
let mouseX     = 640;   // track last known mouse position
let mouseY     = 400;
const state    = { status: 'starting', log: [] };

function addLog(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log('[browser]', msg);
  state.log.unshift(entry);
  if (state.log.length > 60) state.log.pop();
}

// Re-acquire the live ChatGPT page from the browser.
// Called before every request to avoid "detached Frame" errors caused by
// page navigations (reload, new conversation, etc.) after the initial connect.
async function refreshPage() {
  if (!browser) throw new Error('Browser not initialised');
  const pages = await browser.pages();

  // Find a ChatGPT tab whose frame is still alive.
  // A tab can show chatgpt.com in its URL but have a detached internal frame
  // (happens after hard navigations or when reconnecting to Chrome). We verify
  // each candidate with a quick evaluate() before trusting it.
  let livePage = null;
  for (const p of pages) {
    let urlOk = false;
    try { urlOk = p.url().includes('chatgpt.com'); } catch { continue; }
    if (!urlOk) continue;
    try {
      await p.evaluate(() => true);   // throws if frame is detached
      livePage = p;
      break;
    } catch {
      addLog('Skipping stale ChatGPT tab (detached frame)');
    }
  }

  if (livePage) {
    page = livePage;
    return;
  }

  // No live ChatGPT tab — open a fresh one
  page = await browser.newPage();
  addLog('No live ChatGPT tab found — opening one…');
  await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#prompt-textarea', { timeout: 60_000 });
  addLog('ChatGPT tab ready ✓');
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ChatGPT Cage – Browser Server</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#0f0f0f;color:#e8e8e8;display:flex;flex-direction:column;height:100vh}
  header{background:#111;border-bottom:1px solid #222;padding:10px 20px;
         display:flex;align-items:center;gap:12px;flex-shrink:0}
  header h1{font-size:15px;font-weight:600}
  .badge{padding:3px 11px;border-radius:20px;font-size:11px;font-weight:700;
         text-transform:uppercase;letter-spacing:.6px;transition:all .3s}
  .badge.idle       {background:#14532d;color:#4ade80}
  .badge.processing {background:#713f12;color:#fbbf24}
  .badge.starting   {background:#1c1c1c;color:#666}
  .badge.error      {background:#450a0a;color:#f87171}
  main{flex:1;display:grid;grid-template-columns:1fr 300px;overflow:hidden}
  .preview{background:#000;display:flex;align-items:center;justify-content:center;
           position:relative;overflow:hidden}
  .preview img{max-width:100%;max-height:100%;object-fit:contain;display:block}
  .watermark{position:absolute;bottom:8px;right:10px;font-size:10px;color:#444;
             background:rgba(0,0,0,.5);padding:2px 8px;border-radius:4px}
  .sidebar{background:#111;border-left:1px solid #1e1e1e;display:flex;
           flex-direction:column;overflow:hidden}
  .sb-s{padding:12px 14px;border-bottom:1px solid #1a1a1a;flex-shrink:0}
  .sb-s h2{font-size:10px;font-weight:600;color:#555;text-transform:uppercase;
            letter-spacing:.6px;margin-bottom:8px}
  .row{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px}
  .row span:first-child{color:#666}
  .row span:last-child{color:#bbb;font-family:monospace;font-size:11px}
  .hint{background:#0a1628;border:1px solid #1e3a5f;border-radius:6px;
        margin:10px 14px;padding:10px 12px;font-size:11px;color:#60a5fa;line-height:1.7}
  .hint code{background:#0f2846;padding:1px 5px;border-radius:3px;font-size:10px}
  .log-title{font-size:10px;font-weight:600;color:#555;text-transform:uppercase;
             letter-spacing:.6px;padding:10px 14px 6px;border-bottom:1px solid #1a1a1a}
  .log-wrap{flex:1;overflow-y:auto;padding:8px 14px}
  .le{font-size:11px;font-family:monospace;color:#555;padding:3px 0;
      border-bottom:1px solid #141414;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .le:first-child{color:#aaa}
</style>
</head>
<body>
<header>
  <h1>ChatGPT Cage</h1>
  <span class="badge starting" id="badge">starting</span>
  <span id="mode" style="font-size:11px;color:#444;margin-left:4px"></span>
  <span style="font-size:11px;color:#444;margin-left:auto">Browser Server · :${PORT}</span>
</header>
<main>
  <div class="preview">
    <img id="screen" alt="ChatGPT live view">
    <div class="watermark">live preview</div>
  </div>
  <div class="sidebar">
    <div class="sb-s">
      <h2>Status</h2>
      <div class="row"><span>Status</span><span id="s-status">–</span></div>
      <div class="row"><span>Mode</span><span id="s-mode">–</span></div>
      <div class="row"><span>ChatGPT</span><span>${CHATGPT_URL}</span></div>
    </div>
    <div class="hint">
      API server on port 4000:<br>
      <code>POST http://localhost:4000/ask</code><br>
      <code>{ "message": "your question" }</code>
    </div>
    <div class="log-title">Activity Log</div>
    <div class="log-wrap" id="log"></div>
  </div>
</main>
<script>
  function refresh() {
    fetch('/status').then(r => r.json()).then(d => {
      const b = document.getElementById('badge');
      b.className = 'badge ' + d.status;
      b.textContent = d.status;
      document.getElementById('s-status').textContent = d.status;
      document.getElementById('s-mode').textContent = d.mode || '–';
      document.getElementById('mode').textContent = d.mode ? '· ' + d.mode : '';
      if (d.status !== 'starting')
        document.getElementById('screen').src = '/screenshot.jpg?' + Date.now();
      document.getElementById('log').innerHTML =
        d.log.map(l => '<div class="le">' +
          l.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>').join('');
    }).catch(() => {});
  }
  refresh();
  setInterval(refresh, 1500);
</script>
</body>
</html>`);
});

// ── Screenshot ────────────────────────────────────────────────────────────────
app.get('/screenshot.jpg', async (_req, res) => {
  if (!page) return res.status(503).end();
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  res.json({ status: state.status, mode: state.mode, ready: state.status === 'idle', log: state.log.slice(0, 25) });
});

// ── Ask ───────────────────────────────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  if (state.status !== 'idle')
    return res.status(503).json({ error: `Browser busy (${state.status}) — retry shortly` });

  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim())
    return res.status(400).json({ error: '"message" must be a non-empty string' });

  state.status = 'processing';
  addLog(`→ ${message.substring(0, 70)}${message.length > 70 ? '…' : ''}`);

  try {
    // Always refresh the page reference before interacting —
    // prevents "detached Frame" errors from stale page handles.
    await refreshPage();

    const response = await askChatGPT(message.trim());
    addLog(`← ${response.substring(0, 70)}${response.length > 70 ? '…' : ''}`);
    state.status = 'idle';
    res.json({ response });
  } catch (err) {
    addLog(`✗ ${err.message}`);
    state.status = 'error';
    // Auto-recover: refresh page reference and reload ChatGPT
    setTimeout(async () => {
      try {
        addLog('↺ Recovering…');
        await refreshPage();
        await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForSelector('#prompt-textarea', { timeout: 20_000 });
        state.status = 'idle';
        addLog('↺ Recovered ✓');
      } catch (e) {
        addLog('✗ Recovery failed: ' + e.message);
        state.status = 'error';
      }
    }, 3_000);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ChatGPT Automation
// ═════════════════════════════════════════════════════════════════════════════

async function askChatGPT(message) {
  // Ensure input box is ready
  await page.waitForSelector('#prompt-textarea', { visible: true, timeout: 10_000 });

  // Count existing assistant messages so we know when a new one appears
  const prevCount = await page.evaluate(() =>
    document.querySelectorAll('[data-message-author-role="assistant"]').length
  );

  // ── Step 1: Click the input using natural mouse movement ──────────────────
  const inputBox = await page.$('#prompt-textarea');
  if (!inputBox) throw new Error('Input box not found in DOM');
  const inputRect = await inputBox.boundingBox();
  if (!inputRect) throw new Error('Input box has no bounding box (hidden?)');

  // Move mouse naturally to the input box center, then click
  const targetX = inputRect.x + inputRect.width  * (0.3 + Math.random() * 0.4);
  const targetY = inputRect.y + inputRect.height * (0.3 + Math.random() * 0.4);
  await moveMouseNaturally(targetX, targetY);
  await jitter(30, 60);
  await page.mouse.click(targetX, targetY);
  await jitter(40, 80);

  // ── Step 2: Focus and clear the input via Puppeteer keyboard API ─────────
  // page.focus() sends a real focus event — more reliable than el.focus() inside
  // page.evaluate(), which loses context across async boundaries.
  await page.focus('#prompt-textarea');
  await jitter(30, 60);

  // Select-all then delete using keyboard shortcuts (works with ProseMirror)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.keyboard.press('KeyA');
  await page.keyboard.up(mod);
  await sleep(80);
  await page.keyboard.press('Backspace');
  await jitter(60, 120);

  // ── Step 3: Type message with a small fixed delay per character
  // page.keyboard.type() sends real browser keyboard events that ProseMirror's
  // event handler processes correctly. A fixed 5ms delay keeps timing natural
  // while being ~3x faster than the previous randomised 8–22ms per character.
  await page.keyboard.type(message, { delay: 5 });

  await jitter(60, 120);

  // Verify text was inserted
  const hasText = await page.evaluate(() => {
    const el = document.querySelector('#prompt-textarea');
    return el ? el.textContent.trim().length > 0 : false;
  });
  if (!hasText) throw new Error('Text insertion failed — input is still empty after typing');

  // ── Step 4: Click send button with natural mouse movement ─────────────────
  await jitter(50, 100);

  const sendSel =
    'button[data-testid="send-button"]:not([disabled]), ' +
    '#composer-submit-button:not([disabled]), '           +
    'button[aria-label="Send message"]:not([disabled]), ' +
    'button[aria-label="Send prompt"]:not([disabled])';

  let sendBtn = null;
  try {
    await page.waitForSelector(sendSel, { timeout: 5_000 });
    sendBtn = await page.$(sendSel);
  } catch (_) { /* fall through to Enter key */ }

  if (sendBtn) {
    const btnRect = await sendBtn.boundingBox();
    if (btnRect) {
      const bx = btnRect.x + btnRect.width  / 2 + (Math.random() - 0.5) * 8;
      const by = btnRect.y + btnRect.height / 2 + (Math.random() - 0.5) * 8;
      await moveMouseNaturally(bx, by);
      await jitter(25, 50);
      await page.mouse.click(bx, by);
    } else {
      await sendBtn.click();
    }
  } else {
    addLog('Send button not found — pressing Enter');
    await page.keyboard.press('Enter');
  }

  // ── Step 5: Wait for a new assistant message ──────────────────────────────
  // 60s timeout: long messages take ~10s to type + ChatGPT may think before responding
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-message-author-role="assistant"]').length > prev,
    { timeout: 60_000 },
    prevCount
  );

  // ── Step 6: Wait for streaming to finish ──────────────────────────────────
  return await waitForStreamingComplete();
}

// ── Wait for ChatGPT to finish generating (content stability + no stop btn) ──
async function waitForStreamingComplete() {
  const STABLE_MS = 800;
  const POLL_MS   = 250;
  const TIMEOUT   = 90_000;
  const start     = Date.now();

  // Pause briefly so streaming has time to start before we begin stability checks
  await sleep(200);

  return new Promise((resolve, reject) => {
    let lastContent = null;
    let stableSince = null;

    const check = async () => {
      if (Date.now() - start > TIMEOUT) {
        reject(new Error('Timed out waiting for ChatGPT to finish (90s)'));
        return;
      }

      let content, streaming;
      try {
        ({ content, streaming } = await page.evaluate(() => {
          const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
          const last = msgs[msgs.length - 1];
          return {
            content:   last ? last.innerText.trim() : '',
            streaming: !!(
              document.querySelector('button[data-testid="stop-button"]') ||
              document.querySelector('button[aria-label*="Stop"]')        ||
              document.querySelector('[data-is-generating]')
            ),
          };
        }));
      } catch (err) {
        reject(err);
        return;
      }

      if (content !== lastContent) {
        lastContent = content;
        stableSince = content.length > 0 ? Date.now() : null;
      }

      const stableFor = stableSince ? (Date.now() - stableSince) : 0;

      if (!streaming && stableFor >= STABLE_MS && content.length > 0) {
        resolve(content);
      } else {
        setTimeout(check, POLL_MS);
      }
    };

    check();
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Human-like mouse movement  (cubic bezier curve)
// ═════════════════════════════════════════════════════════════════════════════

async function moveMouseNaturally(toX, toY) {
  const fromX = mouseX;
  const fromY = mouseY;

  // Two random control points for a smooth, slightly wobbly curve
  const cp1x = fromX + (toX - fromX) * rand(0.2, 0.4) + rand(-80, 80);
  const cp1y = fromY + (toY - fromY) * rand(0.1, 0.3) + rand(-80, 80);
  const cp2x = fromX + (toX - fromX) * rand(0.6, 0.8) + rand(-60, 60);
  const cp2y = fromY + (toY - fromY) * rand(0.6, 0.8) + rand(-60, 60);

  const steps = Math.floor(rand(8, 14));

  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const u  = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;

    const x = Math.round(u3 * fromX + 3 * u2 * t * cp1x + 3 * u * t2 * cp2x + t3 * toX);
    const y = Math.round(u3 * fromY + 3 * u2 * t * cp1y + 3 * u * t2 * cp2y + t3 * toY);

    await page.mouse.move(x, y);
    await sleep(rand(5, 18));
  }

  mouseX = toX;
  mouseY = toY;
}

// ═════════════════════════════════════════════════════════════════════════════
//  LAYER 1: Try to connect to user's real Chrome
//  LAYER 2: Fall back to Puppeteer launch with stealth patches
// ═════════════════════════════════════════════════════════════════════════════

async function isRealChromeRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${DEBUG_PORT}/json/version`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function connectToRealChrome() {
  addLog(`Connecting to real Chrome on port ${DEBUG_PORT}…`);
  browser = await puppeteer.connect({
    browserURL:      `http://localhost:${DEBUG_PORT}`,
    defaultViewport: null,
  });
  state.mode = 'real-chrome';
  addLog('Connected to real Chrome ✓  (no bot-detection flags)');
}

async function launchStealthChrome() {
  addLog('No real Chrome found — launching with stealth patches…');

  browser = await puppeteer.launch({
    headless:        false,
    userDataDir:     PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // key flag: hides CDP
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'], // removes the "Chrome is controlled" banner
  });

  state.mode = 'stealth-launch';
  addLog('Browser launched');
}

// Stealth patches — applied before the page loads so ChatGPT never sees raw values
async function applyStealthPatches(targetPage) {
  await targetPage.evaluateOnNewDocument(() => {
    // 1. Hide webdriver flag (the #1 detection signal)
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. Fake a realistic plugin list (Puppeteer has 0 by default)
    const fakePlugin = (name, filename, desc) => {
      const plugin = { name, filename, description: desc, length: 1 };
      plugin[0] = { type: 'application/x-google-chrome-pdf', suffixes: 'pdf',
                    description: 'Portable Document Format', enabledPlugin: plugin };
      return plugin;
    };
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const list = [
          fakePlugin('Chrome PDF Plugin',  'internal-pdf-viewer', 'Portable Document Format'),
          fakePlugin('Chrome PDF Viewer',  'mhjfbmdgcfjbbpaeojofohoefgiehjai', ''),
          fakePlugin('Native Client',      'internal-nacl-plugin', ''),
        ];
        list.length = 3;
        return list;
      },
    });

    // 3. Real languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // 4. Restore window.chrome (absent in headless, suspicious)
    window.chrome = {
      app:          { isInstalled: false },
      webstore:     { onInstallStageChanged: {}, onDownloadProgress: {} },
      runtime:      { PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android',
                                    CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
                      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
                      RequestUpdateCheckStatus: { THROTTLED: 'throttled',
                                                  NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
                      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update',
                                          CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' } },
    };

    // 5. Patch Permissions API (automation check via notification permission)
    if (window.Permissions && window.Permissions.prototype.query) {
      const orig = window.Permissions.prototype.query;
      window.Permissions.prototype.query = function (params) {
        if (params.name === 'notifications')
          return Promise.resolve({ state: Notification.permission, onchange: null });
        return orig.call(this, params);
      };
    }

    // 6. Scrub CDP automation artifacts left in window by ChromeDriver
    const cdpKeys = Object.keys(window).filter(k => k.startsWith('cdc_'));
    cdpKeys.forEach(k => { try { delete window[k]; } catch (_) {} });
  });

  addLog('Stealth patches applied ✓');
}

// ═════════════════════════════════════════════════════════════════════════════
//  Browser init
// ═════════════════════════════════════════════════════════════════════════════

async function init() {
  // Layer 1: Connect to real Chrome if available
  const realChromeRunning = await isRealChromeRunning();

  if (realChromeRunning) {
    await connectToRealChrome();
    // Find (or open) a ChatGPT tab
    const pages = await browser.pages();
    const chatPage = pages.find(p => {
      try { return p.url().includes('chatgpt.com'); } catch { return false; }
    });
    page = chatPage || await browser.newPage();
    if (!chatPage) {
      await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
  } else {
    // Layer 2: Stealth launch fallback
    await launchStealthChrome();

    const allPages = await browser.pages();
    page = allPages[0] || await browser.newPage();

    // Apply stealth patches BEFORE navigation so they're in place when page loads
    await applyStealthPatches(page);

    // Grant clipboard permissions (needed for paste-based input)
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(CHATGPT_URL, ['clipboard-read', 'clipboard-write']);

    addLog(`Opening ${CHATGPT_URL}…`);
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  addLog('Waiting for ChatGPT input (log in if prompted)…');
  await page.waitForSelector('#prompt-textarea', { timeout: 120_000 });

  state.status = 'idle';
  addLog(`Ready ✓  [${state.mode}]`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  Utilities
// ═════════════════════════════════════════════════════════════════════════════

function sleep(ms)         { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max)    { return min + Math.random() * (max - min); }
async function jitter(lo, hi) { await sleep(rand(lo, hi)); }

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n[browser] Dashboard  →  http://localhost:${PORT}`);
  console.log(`[browser] POST /ask  →  http://localhost:${PORT}/ask\n`);
  try {
    await init();
  } catch (err) {
    addLog('✗ Startup error: ' + err.message);
    state.status = 'error';
    console.error('[browser] Fatal:', err.message);
  }
});

process.on('SIGINT', async () => {
  console.log('\n[browser] Shutting down…');
  if (browser) {
    // In connect mode, just disconnect — don't close the user's browser
    if (state.mode === 'real-chrome') browser.disconnect();
    else await browser.close().catch(() => {});
  }
  process.exit(0);
});
