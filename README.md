# ChatGPT Cage

> Automate ChatGPT via a local REST API — no OpenAI API key, no cost, no rate limits beyond your account tier.

ChatGPT Cage drives a real Chrome browser using Puppeteer and exposes a clean HTTP API on your machine. Any script, app, or tool can send a message to ChatGPT and get the response back in plain JSON.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Example Client](#example-client)
- [Dashboards](#dashboards)
- [Anti-Bot Strategy](#anti-bot-strategy)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Alternative: Extension Mode](#alternative-extension-mode)
- [Rules & Limitations](#rules--limitations)

---

## How It Works

Three processes co-operate on your local machine:

```
Your App / curl / Python script
          │
          │  POST /ask  { "message": "..." }
          ▼
  ┌─────────────────────┐
  │   api-server.js     │  Port 4000  ← public REST API + web UI
  └──────────┬──────────┘
             │  HTTP proxy
             ▼
  ┌─────────────────────┐
  │  browser-server.js  │  Port 3001  ← Puppeteer controller + live dashboard
  └──────────┬──────────┘
             │  Chrome DevTools Protocol (CDP)
             ▼
  ┌─────────────────────┐
  │   Chrome  :9222     │  ← real Chrome with your ChatGPT session
  └──────────┬──────────┘
             │
             ▼
        chatgpt.com
```

| Process | Port | File | Role |
|---------|------|------|------|
| Chrome | 9222 | `server/start-chrome.js` | Real browser with remote debugging enabled |
| Browser Server | 3001 | `server/browser-server.js` | Puppeteer automation — types, clicks, reads responses |
| API Server | 4000 | `server/api-server.js` | REST API gateway + test UI |

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | v18 or later |
| Google Chrome | Any recent version (Chromium / Brave also work) |
| ChatGPT account | Free tier is sufficient |

---

## Installation

```bash
git clone <repo-url>
cd "chart gpt cage"
cd server && npm install
```

> **First-time login:** You will log into ChatGPT manually once in the Chrome window that opens. Your session is saved locally and reused on every subsequent run.

---

## Quick Start

Open **three terminal windows**, all from the project root:

### Terminal 1 — Chrome

```bash
npm run chrome
```

Chrome opens and navigates to `chatgpt.com`. **Log in to your ChatGPT account** if prompted (first run only). Keep this terminal running.

Expected output:
```
▶  Launching Chrome with remote-debugging (port 9222)…
```

---

### Terminal 2 — Browser Server

```bash
npm run browser
```

Expected output:
```
[browser] Connected to real Chrome ✓  (no bot-detection flags)
[browser] Ready ✓  [real-chrome]
```

Live dashboard: **http://localhost:3001**

---

### Terminal 3 — API Server

```bash
npm run api
```

Expected output:
```
[api] ChatGPT Cage API  →  http://localhost:4000
```

Test UI: **http://localhost:4000**

---

## API Reference

### `POST /ask`

Send a message to ChatGPT. The request blocks until a full response is received.

**Request**

```http
POST http://localhost:4000/ask
Content-Type: application/json

{
  "message": "Explain recursion in one sentence."
}
```

**Response — success**

```json
{
  "response": "Recursion is a technique where a function calls itself to solve smaller instances of the same problem until a base case is reached."
}
```

**Response — error**

```json
{
  "error": "Browser busy (processing) — retry shortly"
}
```

| HTTP Code | Meaning |
|-----------|---------|
| `200` | Success — `response` field contains ChatGPT's reply |
| `400` | Bad request — `message` field is missing or empty |
| `502` | Browser server error — check status, restart if needed |
| `503` | Browser is busy or not ready |

---

### `GET /status`

Health check for all components.

```bash
curl http://localhost:4000/status
```

```json
{
  "api": "ok",
  "browser": {
    "status": "idle",
    "mode": "real-chrome",
    "ready": true,
    "log": [...]
  }
}
```

**`browser.status` values**

| Value | Meaning |
|-------|---------|
| `starting` | Server is initialising |
| `idle` | Ready — send requests freely |
| `processing` | Handling a request — wait before sending another |
| `error` | Crashed — restart `npm run browser` |

---

### `GET /screenshot.jpg`

Returns a live JPEG screenshot of the browser window (useful for debugging).

```
http://localhost:3001/screenshot.jpg
```

---

## Example Client

A Python CLI chat client is included at `test.py`:

```bash
python3 test.py
```

```
==================================================
🤝 AI Friend CLI Chat
Type 'exit' to quit
==================================================

You: hey, how are you?
AI: Doing great, thanks for asking! 😊 What's on your mind?

You: exit
AI: Bye! Talk soon 👋
```

You can use the API from any language:

**Python**
```python
import requests

r = requests.post("http://localhost:4000/ask", json={"message": "Hello!"})
print(r.json()["response"])
```

**JavaScript / Node.js**
```js
const res = await fetch("http://localhost:4000/ask", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Hello!" }),
});
const { response } = await res.json();
console.log(response);
```

**curl**
```bash
curl -X POST http://localhost:4000/ask \
  -H "Content-Type: application/json" \
  -d '{ "message": "Hello!" }'
```

---

## Dashboards

| URL | Description |
|-----|-------------|
| http://localhost:4000 | API test UI — send messages from the browser |
| http://localhost:3001 | Browser dashboard — live screenshot + activity log |
| http://localhost:3001/screenshot.jpg | Raw screenshot (auto-refreshes) |

---

## Anti-Bot Strategy

ChatGPT Cage uses three layers of detection evasion:

### Layer 1 — Real Chrome (primary)
Connects to your actual Chrome browser via CDP. The browser has a real user profile, real history, real plugins, and no `navigator.webdriver` flag — indistinguishable from normal browsing.

### Layer 2 — Stealth patches (fallback)
If no real Chrome is found, Puppeteer launches its own Chrome with manual patches applied before any page loads:
- Removes `navigator.webdriver`
- Fakes a realistic plugin list
- Restores `window.chrome` object
- Patches the Permissions API
- Scrubs CDP automation artifacts (`cdc_` prefixed keys)

### Layer 3 — Human-like interactions (always active)
Every interaction mimics natural human behaviour:
- **Mouse movement** — cubic Bézier curves with random jitter
- **Typing** — character-by-character with 8–22 ms random delays
- **Timing** — randomised pauses between all actions

---

## Project Structure

```
chart gpt cage/
│
├── package.json              # Root npm scripts
│
├── server/
│   ├── package.json          # Dependencies: express, puppeteer
│   ├── start-chrome.js       # Launches real Chrome on port 9222
│   ├── browser-server.js     # Puppeteer automation engine  →  :3001
│   ├── api-server.js         # Public REST API + web UI     →  :4000
│   └── server.js             # WebSocket server (extension mode)
│
├── extension/
│   ├── manifest.json         # Chrome extension manifest (MV3)
│   ├── background.js         # Service worker — WebSocket relay + keep-alive
│   ├── content.js            # Content script — DOM automation on chatgpt.com
│   ├── popup.html            # Extension popup UI
│   └── popup.js              # Popup logic
│
├── test.py                   # Python CLI chat client
├── .gitignore
└── README.md
```

---

## Troubleshooting

### Browser status stuck at `error`

The browser server crashed. Restart it:

```bash
# Press Ctrl+C in the terminal running npm run browser, then:
npm run browser
```

Wait for `Ready ✓` before sending requests.

---

### `Error 502` from the API

The browser server is in an error or busy state. Check status first:

```bash
curl http://localhost:4000/status
```

If `browser.status` is `error`, restart the browser server (see above).

---

### Chrome not found

Override the path with an environment variable:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run chrome
```

---

### Port 9222 already in use

Chrome with remote debugging is already running. Skip `npm run chrome` — go straight to `npm run browser`.

---

### Login required / session expired

ChatGPT will show a login page inside the Chrome window. Log in manually — your session is saved in `server/.chatgpt-profile/` and persists across all future restarts.

---

### Requests time out on long conversations

Each message in `test.py` sends the full conversation history. Longer history = longer message = more time to type. The system handles this automatically (60 s for ChatGPT to start responding, 90 s for full streaming).

---

## Alternative: Extension Mode

A Chrome extension is included for cases where Puppeteer access is not possible.

**Setup:**
1. Go to `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` folder
3. Open `chatgpt.com` in Chrome
4. Start the WebSocket server:
   ```bash
   node server/server.js
   ```

The extension connects via WebSocket and exposes the same `POST /ask` interface on port 4000.

> The Puppeteer mode (`npm run browser`) is more reliable and recommended. Use the extension mode only when needed.

---

## Rules & Limitations

| Rule | Reason |
|------|--------|
| Do not navigate the ChatGPT tab while a request is in flight | Causes frame detachment and crashes the browser server |
| Do not click "New chat" between requests | Changes the internal page frame reference |
| Send one request at a time | The server queues one request; concurrent calls return `503` |
| Keep the ChatGPT tab in the foreground | Chrome may throttle or freeze background tabs |
| This project uses your ChatGPT account | Respect OpenAI's Terms of Service for automated usage |

---

## How It Works for New Contributors

When someone clones this repository:

1. `server/.chatgpt-profile/` does **not** exist (it is gitignored)
2. Running `npm run chrome` creates a fresh profile on their machine
3. They log into ChatGPT once with **their own account**
4. Their session is saved locally — no credentials are shared or stored in the repo

No API keys. No configuration files. No shared secrets.
