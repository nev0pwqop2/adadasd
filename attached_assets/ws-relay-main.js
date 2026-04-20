const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const SOURCE_URL      = "ws://141.11.243.16:5894";           // where logs come from
const SOURCE_AUTH_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF"; // receiver key for source WS
const DOWNSTREAM_URL  = "wss://ws-server-6k5k.onrender.com"; // where to forward encrypted logs
const DOWNSTREAM_SENDER_KEY = "6767";                        // sender key for downstream relay
const ENCRYPTION_KEY  = "12345678901234567890123456789012";  // must match Lua receiver
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
    console.log(`✅ Connected to downstream relay`);
  });

  downstream.on('message', (msg) => console.log(`[downstream] ${msg}`));

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

function forwardToDownstream(raw) {
  if (!dsReady || downstream.readyState !== WebSocket.OPEN) {
    console.warn('⚠️ Downstream not ready — message dropped');
    return;
  }
  const encrypted = encrypt(raw);
  downstream.send(encrypted);
  console.log('📤 Forwarded encrypted message to downstream');
}

// ── Source WS connection ──────────────────────────────────────────────────────
let source      = null;
let srcAuthed   = false;

function connectSource() {
  source    = new WebSocket(SOURCE_URL);
  srcAuthed = false;

  source.on('open', () => {
    console.log('📡 Connected to source WS — authenticating…');
    source.send(JSON.stringify({ auth: SOURCE_AUTH_KEY }));
  });

  source.on('message', (msg) => {
    const raw = msg.toString();
    let data;
    try { data = JSON.parse(raw); } catch { /* not JSON */ }

    if (!srcAuthed) {
      if (data && (data.success || data.role === 'receiver')) {
        srcAuthed = true;
        console.log('🔑 Authenticated with source WS as receiver');
      } else {
        console.warn('[source] Auth response:', raw);
      }
      return;
    }

    // Got a log message — encrypt and forward
    console.log('📨 Log received from source');
    forwardToDownstream(raw);
  });

  source.on('close', () => {
    srcAuthed = false;
    console.log('⚠️ Source closed — reconnecting in 5s…');
    setTimeout(connectSource, 5000);
  });

  source.on('error', (err) => {
    srcAuthed = false;
    console.error('❌ Source error:', err.message);
  });
}

// ── Keep-alive HTTP server (required by Render) ───────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('relay running');
});
server.listen(PORT, () => console.log(`🌐 HTTP keep-alive on port ${PORT}`));

// ── Start ─────────────────────────────────────────────────────────────────────
connectDownstream();
connectSource();
