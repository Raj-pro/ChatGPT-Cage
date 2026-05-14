const express = require('express');
const http    = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.json());

// ── Single HTTP server (port 4000) shared by Express + WebSocket ─────────────
// This avoids needing a second port, which macOS may block with EPERM.
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });       // attaches to same port

let extensionSocket = null;
const pending = new Map(); // requestId -> { resolve, reject, timeoutId }

// ── WebSocket: extension connects here ───────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('[cage] Extension connected via WS');
  extensionSocket = ws;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'response' && pending.has(msg.requestId)) {
        const { resolve, timeoutId } = pending.get(msg.requestId);
        clearTimeout(timeoutId);
        pending.delete(msg.requestId);
        resolve(msg.text);
      }
    } catch (e) {
      console.error('[cage] Bad message from extension:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[cage] Extension disconnected');
    extensionSocket = null;
    for (const [id, { reject, timeoutId }] of pending) {
      clearTimeout(timeoutId);
      reject(new Error('Extension disconnected'));
    }
    pending.clear();
  });
});

// ── POST /ask ─────────────────────────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: '"message" field is required' });
  }

  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: 'Extension not connected — open ChatGPT in Chrome' });
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const text = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Timed out waiting for ChatGPT response (120s)'));
      }, 120_000);

      pending.set(requestId, { resolve, reject, timeoutId });
      extensionSocket.send(JSON.stringify({ type: 'ask', requestId, message }));
    });

    res.json({ response: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  res.json({ extensionConnected: extensionSocket?.readyState === WebSocket.OPEN });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[cage] HTTP + WS → http://localhost:${PORT}`);
  console.log(`[cage] WS endpoint → ws://localhost:${PORT}`);
  console.log(`[cage] POST http://localhost:${PORT}/ask  { "message": "..." }`);
});
