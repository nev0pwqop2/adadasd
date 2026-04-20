const WebSocket = require('ws');
const crypto = require('crypto');

const SECRET_KEY      = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";
const SENDER_AUTH_KEY = "LDJFSIJ3I4J2IO1111";
const ENCRYPTION_KEY  = "12345678901234567890123456789012"; // must match Lua
const DOWNSTREAM_URL  = "wss://ws-server-6k5k.onrender.com";
const DOWNSTREAM_SENDER_KEY = "6767"; // SENDER_AUTH_KEY of the downstream relay
const PORT = process.env.PORT || 8080;

// ── SHA256 stream cipher ──────────────────────────────────────────────────────
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function encrypt(plaintext) {
  const inputBuf = Buffer.from(plaintext, 'utf8');
  const keyBase  = sha256(Buffer.from(ENCRYPTION_KEY, 'utf8'));
  const out      = Buffer.alloc(inputBuf.length);
  let blockIndex = 0;
  let block      = sha256(Buffer.concat([keyBase, uint32BE(0)]));

  for (let i = 0; i < inputBuf.length; i++) {
    const pos = i % 32;
    if (i > 0 && pos === 0) {
      blockIndex++;
      block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)]));
    }
    out[i] = inputBuf[i] ^ block[pos];
  }
  return out.toString('hex');
}

// ── Downstream relay connection ───────────────────────────────────────────────
let downstream = null;
let dsReady    = false;

function connectDownstream() {
  downstream = new WebSocket(`${DOWNSTREAM_URL}/auth/${DOWNSTREAM_SENDER_KEY}`);

  downstream.on('open', () => {
    dsReady = true;
    console.log(`✅ Connected to downstream relay as sender`);
  });

  downstream.on('message', (msg) => {
    // downstream acks/info — ignore
    console.log(`[downstream] ${msg}`);
  });

  downstream.on('close', () => {
    dsReady = false;
    console.log('⚠️ Downstream closed — reconnecting in 5s…');
    setTimeout(connectDownstream, 5000);
  });

  downstream.on('error', (err) => {
    dsReady = false;
    console.error('❌ Downstream error:', err.message);
  });
}

connectDownstream();

// ── Forward (encrypted) to downstream ────────────────────────────────────────
function forwardToDownstream(data) {
  if (!dsReady || downstream.readyState !== WebSocket.OPEN) {
    console.warn('⚠️ Downstream not ready — message dropped');
    return;
  }
  const encrypted = encrypt(JSON.stringify(data));
  downstream.send(encrypted);
  console.log(`📤 Forwarded encrypted message to downstream`);
}

// ── Main relay server ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });
console.log(`✅ WS relay running on port ${PORT}`);

function normalizeAuthFromUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith('/auth/')) return "";
  const noQuery  = rawUrl.split('?')[0];
  const tokenPart = noQuery.slice('/auth/'.length).replace(/\/+$/, '');
  try { return decodeURIComponent(tokenPart); } catch { return tokenPart; }
}

wss.on('connection', (ws, req) => {
  console.log('📡 Client connected');
  ws.isAuthenticated = false;
  ws.role = null;

  if (req.url && req.url.startsWith('/auth/')) {
    const provided = normalizeAuthFromUrl(req.url);
    if (provided === SENDER_AUTH_KEY) {
      ws.isAuthenticated = true;
      ws.role = "sender";
      ws.send(JSON.stringify({ success: "✅ Sender authenticated via URL", role: "sender" }));
      console.log('🔑 Sender authenticated (URL)');
    } else {
      ws.send(JSON.stringify({ error: "❌ Unauthorized" }));
      ws.close(1008, "Bad key");
    }
    bindHandlers(ws);
    return;
  }

  ws.send(JSON.stringify({ info: '🔒 Send {"auth":"SENDER_AUTH_KEY"} to authenticate as sender' }));
  bindHandlers(ws);
});

function bindHandlers(ws) {
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!ws.isAuthenticated) {
      if (data.auth === SENDER_AUTH_KEY) {
        ws.isAuthenticated = true;
        ws.role = "sender";
        ws.send(JSON.stringify({ success: "✅ Authenticated!", role: "sender" }));
        console.log('🔑 Sender authenticated via message');
        return;
      }
      ws.send(JSON.stringify({ error: "❌ Wrong auth key" }));
      return;
    }

    if (ws.role === "sender") {
      console.log('📨 Sender message received — forwarding encrypted');
      forwardToDownstream(data);
      return;
    }
  });

  ws.on('close', () => console.log('👋 Client disconnected'));
}
