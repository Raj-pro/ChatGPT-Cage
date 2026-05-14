/**
 * api-server.js  –  Port 4000
 *
 * The public-facing REST API.  Users POST their questions here; this server
 * forwards them to browser-server.js (port 3001) which controls the actual
 * ChatGPT browser, then returns the response.
 *
 * Endpoints:
 *   POST /ask    { "message": "your question" }  →  { "response": "..." }
 *   GET  /status                                  →  { api, browser }
 *
 * Start: node api-server.js
 * (browser-server.js must already be running)
 */

'use strict';

const express = require('express');
const http    = require('http');

const PORT         = 4000;
const BROWSER_HOST = 'localhost';
const BROWSER_PORT = 3001;

const app = express();
app.use(express.json());

// ── CORS (allows requests from any local origin / curl / web app) ─────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// ── Simple test UI served at the root ─────────────────────────────────────────
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ChatGPT Cage – API</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#0f0f0f;color:#e8e8e8;min-height:100vh;
       display:flex;flex-direction:column;align-items:center;padding:40px 16px}
  h1{font-size:18px;font-weight:600;margin-bottom:4px}
  .sub{font-size:12px;color:#555;margin-bottom:32px}
  .card{width:100%;max-width:560px;background:#111;border:1px solid #222;
        border-radius:10px;padding:20px;margin-bottom:16px}
  .card h2{font-size:12px;font-weight:600;color:#555;text-transform:uppercase;
           letter-spacing:.5px;margin-bottom:12px}
  textarea{width:100%;height:100px;background:#1a1a1a;border:1px solid #2a2a2a;
           border-radius:7px;color:#e8e8e8;font-family:inherit;font-size:13px;
           padding:10px 12px;resize:vertical;outline:none;transition:border .2s}
  textarea:focus{border-color:#10a37f}
  button{margin-top:10px;width:100%;padding:9px;background:#10a37f;color:#fff;
         border:none;border-radius:7px;font-size:13px;font-weight:600;
         cursor:pointer;transition:background .2s}
  button:hover:not(:disabled){background:#0d8f6f}
  button:disabled{opacity:.4;cursor:not-allowed}
  #resp{margin-top:12px;font-size:13px;line-height:1.6;color:#ccc;
        white-space:pre-wrap;word-break:break-word;min-height:24px}
  #resp.err{color:#f87171}
  .status-row{display:flex;justify-content:space-between;font-size:12px;
              padding:4px 0;border-bottom:1px solid #1a1a1a}
  .status-row span:first-child{color:#666}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;
       background:#555;margin-right:5px;vertical-align:middle}
  .dot.ok{background:#22c55e} .dot.busy{background:#f59e0b} .dot.off{background:#ef4444}
  code{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:5px;
       padding:2px 7px;font-size:11px;color:#aaa}
</style>
</head>
<body>
<h1>ChatGPT Cage</h1>
<p class="sub">API Server &nbsp;·&nbsp; port <strong>${PORT}</strong></p>

<div class="card">
  <h2>Status</h2>
  <div class="status-row">
    <span>API Server</span>
    <span><span class="dot ok"></span>Online</span>
  </div>
  <div class="status-row" id="browser-row">
    <span>Browser Server</span>
    <span><span class="dot" id="bdot"></span><span id="btext">checking…</span></span>
  </div>
</div>

<div class="card">
  <h2>Send a message</h2>
  <textarea id="msg" placeholder="Ask ChatGPT anything…"></textarea>
  <button id="btn" disabled>Send</button>
  <div id="resp"></div>
</div>

<div class="card">
  <h2>curl example</h2>
  <code>curl -X POST http://localhost:${PORT}/ask \\<br>
  &nbsp; -H "Content-Type: application/json" \\<br>
  &nbsp; -d '{ "message": "Hello!" }'</code>
</div>

<script>
  const btn = document.getElementById('btn');
  const msg = document.getElementById('msg');
  const resp = document.getElementById('resp');

  // Check status
  function checkStatus() {
    fetch('/status')
      .then(r => r.json())
      .then(d => {
        const dot  = document.getElementById('bdot');
        const text = document.getElementById('btext');
        const bs   = d.browser?.status ?? 'offline';
        dot.className  = 'dot ' + (bs === 'idle' ? 'ok' : bs === 'processing' ? 'busy' : 'off');
        text.textContent = bs;
        btn.disabled = bs !== 'idle';
      }).catch(() => {});
  }
  checkStatus();
  setInterval(checkStatus, 3000);

  // Send
  btn.addEventListener('click', async () => {
    const message = msg.value.trim();
    if (!message) return;
    btn.disabled = true;
    resp.className = '';
    resp.textContent = 'Waiting for ChatGPT…';
    try {
      const r = await fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(125_000),
      });
      const data = await r.json();
      if (data.error) { resp.className = 'err'; resp.textContent = data.error; }
      else { resp.textContent = data.response; }
    } catch (e) {
      resp.className = 'err';
      resp.textContent = e.name === 'TimeoutError' ? 'Request timed out (125s)' : e.message;
    }
    btn.disabled = false;
  });

  msg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btn.click();
  });
</script>
</body>
</html>`);
});

// ── GET /status ───────────────────────────────────────────────────────────────
app.get('/status', async (_req, res) => {
  try {
    const data = await proxyRequest('GET', '/status', null, 3_000);
    res.json({ api: 'ok', browser: data });
  } catch (err) {
    res.json({ api: 'ok', browser: { status: 'offline', error: err.message } });
  }
});

// ── POST /ask ─────────────────────────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  const { message } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '"message" must be a non-empty string' });
  }

  try {
    const data = await proxyRequest('POST', '/ask', { message: message.trim() }, 125_000);
    if (data.error) return res.status(502).json({ error: data.error });
    res.json({ response: data.response });
  } catch (err) {
    res.status(502).json({ error: 'Browser server error: ' + err.message });
  }
});

// ── HTTP proxy helper ─────────────────────────────────────────────────────────
function proxyRequest(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: BROWSER_HOST,
      port:     BROWSER_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Request to browser server timed out (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try   { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Invalid JSON from browser server')); }
      });
    });

    req.on('error', err => { clearTimeout(timer); reject(err); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[api] ChatGPT Cage API   →  http://localhost:${PORT}`);
  console.log(`[api] Test UI            →  http://localhost:${PORT}/`);
  console.log(`[api] POST /ask          →  http://localhost:${PORT}/ask`);
  console.log(`[api] GET  /status       →  http://localhost:${PORT}/status`);
  console.log(`[api] Browser dashboard  →  http://localhost:${BROWSER_PORT}/\n`);
});
