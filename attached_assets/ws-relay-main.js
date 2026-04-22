const WebSocket = require('ws');
const crypto = require('crypto');

const SOURCE_URL      = "ws://141.11.243.16:4141";
const SOURCE_AUTH_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF";
const ENCRYPTION_KEY  = "12345678901234567890123456789012"; // must match Lua receiver
const LUARMOR_API_KEY = process.env.LUARMOR_API_KEY;
const LUARMOR_PROJECT_ID = process.env.LUARMOR_PROJECT_ID;
const PORT = process.env.PORT || 8080;

// HTTP poll sources — add more entries here as needed
const HTTP_SOURCES = [
  {
    name: "railway-job",
    url: "https://087uy1728987anghuaga.up.railway.app/get_job",
    params: {
      client_id: "2519904148",
      _t: "TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm",
    },
    intervalMs: 3000, // poll every 3 seconds
  },
  // Add more sources here:
  // { name: "source2", url: "https://...", params: { ... }, intervalMs: 3000 },
];

// ── Luarmor key validation ────────────────────────────────────────────────────
async function validateLuarmorKey(userKey) {
  const res = await fetch(
    `https://api.luarmor.net/v3/projects/${LUARMOR_PROJECT_ID}/users?user_key=${encodeURIComponent(userKey)}`,
    { headers: { Authorization: LUARMOR_API_KEY } }
  );
  if (!res.ok) return { valid: false, reason: `Luarmor API error: ${res.status}` };
  const data = await res.json();
  const user = data.users?.[0];
  if (!user) return { valid: false, reason: "Key not found" };
  if (user.banned) return { valid: false, reason: "Key is banned" };
  if (user.auth_expire !== -1 && user.auth_expire < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "Key has expired" };
  }
  return { valid: true, auth_expire: user.auth_expire };
}

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

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });
console.log(`✅ WS relay server running on port ${PORT}`);

function broadcastToReceivers(raw) {
  const encrypted = encrypt(raw);
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) {
      client.send(encrypted);
      count++;
    }
  });
  console.log(`📤 Broadcast encrypted -> ${count} receiver(s)`);
}

wss.on('connection', (ws) => {
  ws.authenticated = false;
  ws.luarmorKey = null;
  ws.expireTimer = null;

  ws.send(JSON.stringify({ info: 'Send {"key":"YOUR_LUARMOR_KEY"} to authenticate' }));

  ws.on('message', async (msg) => {
    if (ws.authenticated) return; // already in, ignore further messages

    let data;
    try { data = JSON.parse(msg.toString()); } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
      ws.close(1008, "Invalid JSON");
      return;
    }

    if (!data.key) {
      ws.send(JSON.stringify({ error: "Send your Luarmor key as {\"key\":\"...\"}" }));
      ws.close(1008, "No key provided");
      return;
    }

    try {
      const result = await validateLuarmorKey(data.key);
      if (!result.valid) {
        ws.send(JSON.stringify({ error: result.reason }));
        ws.close(1008, result.reason);
        console.log(`❌ Rejected key: ${result.reason}`);
        return;
      }

      ws.authenticated = true;
      ws.luarmorKey = data.key;
      ws.send(JSON.stringify({ success: "✅ Authenticated — receiving logs" }));
      console.log(`🔑 Client authenticated with Luarmor key`);

      // Schedule auto-disconnect at exact expiry time
      if (result.auth_expire !== -1) {
        const msUntilExpiry = (result.auth_expire * 1000) - Date.now();
        if (msUntilExpiry > 0) {
          ws.expireTimer = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ error: "Your key has expired — disconnecting" }));
              ws.close(1008, "Key expired");
              console.log(`⏰ Disconnected client — key expired`);
            }
          }, msUntilExpiry);
        } else {
          // Already expired by the time we get here
          ws.send(JSON.stringify({ error: "Key has expired" }));
          ws.close(1008, "Key expired");
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: "Failed to validate key — try again later" }));
      ws.close(1011, "Validation error");
      console.error("Luarmor validation error:", err.message);
    }
  });

  ws.on('close', () => {
    if (ws.expireTimer) clearTimeout(ws.expireTimer);
    console.log('👋 Client disconnected');
  });
});

// ── Source WS connection (pulls logs) ────────────────────────────────────────
let source    = null;
let srcAuthed = false;

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
        console.log('🔑 Authenticated with source WS');
      } else {
        console.warn('[source] Auth response:', raw);
      }
      return;
    }

    broadcastToReceivers(raw);
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

// ── HTTP poll sources ─────────────────────────────────────────────────────────
function startHttpPoller(source) {
  let since = Date.now() / 1000; // start from now — only get new logs
  let lastSeenTime = null;

  async function poll() {
    try {
      const qs = new URLSearchParams({ ...source.params, since: since.toString() });
      const res = await fetch(`${source.url}?${qs}`);
      if (!res.ok) { console.warn(`[${source.name}] HTTP ${res.status}`); return; }

      const data = await res.json();

      // Skip if no new job or same timestamp as last seen
      if (!data.has_job) return;
      if (data.created_time && data.created_time === lastSeenTime) return;

      lastSeenTime = data.created_time;
      since = data.created_time + 0.001; // advance since past this entry

      console.log(`[${source.name}] New log received — broadcasting`);
      broadcastToReceivers(JSON.stringify({ source: source.name, ...data }));
    } catch (err) {
      console.error(`[${source.name}] Poll error:`, err.message);
    }
  }

  setInterval(poll, source.intervalMs);
  console.log(`✅ HTTP poller started: ${source.name} (every ${source.intervalMs}ms)`);
}

for (const src of HTTP_SOURCES) startHttpPoller(src);

connectSource();
