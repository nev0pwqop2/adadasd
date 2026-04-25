const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const ENCRYPTION_KEY     = "12345678901234567890123456789012";
const LUARMOR_API_KEY    = process.env.LUARMOR_API_KEY;
const LUARMOR_PROJECT_ID = process.env.LUARMOR_PROJECT_ID;
const PORT               = process.env.PORT || 8080;
const WORKER_URL         = process.env.WORKER_URL || "https://calm-night-4622.yohalvata.workers.dev";

const WS_SOURCES = [
  {
    name: "source1",
    url: "ws://141.11.243.16:4141",
    authMessage: JSON.stringify({ auth: "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF" }),
    autoAuth: true,
    skipMessage: () => false,
  },
  {
    name: "projectx",
    url: "wss://projectx.lasupremenotifier.com/ws/client",
    authMessage: null,
    isAuthed: () => true,
    skipMessage: (data) => data && (data.type === 'ping' || data.type === 'init'),
  },
];

const HTTP_SOURCES = [
  {
    name: "railway-job",
    url: () => `${WORKER_URL}/railway1`,
    params: {},
    intervalMs: 100,
    concurrency: 1,
  },
  {
    name: "railway-job-2",
    url: () => `${WORKER_URL}/railway2`,
    params: {},
    intervalMs: 2000,
    concurrency: 1,
  },
  {
    name: "vanishnotifier",
    url: () => `${WORKER_URL}/vanish`,
    params: {},
    intervalMs: 500,
    concurrency: 2,
  },
];

function fmtValue(num, formatted) {
  if (formatted) return formatted;
  const n = Number(num) || 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B/s`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M/s`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K/s`;
  return `$${n}/s`;
}

function formatLog(source, data) {
  let brainrots = null;
  let jobId = null;
  let duelMode = false;

  if (source === 'projectx' && data?.event?.data?.brainrots) {
    brainrots = data.event.data.brainrots;
    jobId = data.event.data.jobId;
    duelMode = brainrots.some(b => b.duel > 0);
  } else if (source === 'source1' && data?.brainrots) {
    brainrots = data.brainrots;
    jobId = data.jobId || data.server_id || null;
    duelMode = brainrots.some(b => b.duel > 0);
  } else if ((source === 'railway-job' || source === 'railway-job-2') && data?.pet_name) {
    const val = Number(data.pet_value) || 0;
    const fmt = fmtValue(val, data.pet_value_formatted);
    return {
      bestName:    `1x ${data.pet_name}`,
      bestValue:   val,
      serverID:    data.server_id || null,
      allBrainrots:`1x ${data.pet_name} (${fmt})`,
      duel:        data.duel_mode === true || data.duel_mode === 1 || false,
    };
  } else if (source === 'vanishnotifier' && data?.name && data?.value) {
    const val = Number(data.value) || 0;
    const serverId = data.server_id || data.job_id || data.serverid || data.jobid || data.serverID || data.jobID || null;
    return {
      bestName:    `1x ${data.name}`,
      bestValue:   val,
      serverID:    serverId,
      allBrainrots:`1x ${data.name} (${fmtValue(val, null)})`,
      duel:        false,
    };
  }

  if (!brainrots || !brainrots.length) return null;

  const counts = {};
  for (const b of brainrots) counts[b.name] = (counts[b.name] || 0) + 1;

  const best = brainrots.reduce((a, b) => b.value > a.value ? b : a);

  const seen = new Set();
  const parts = [];
  for (const b of brainrots) {
    if (!seen.has(b.name)) {
      seen.add(b.name);
      parts.push(`${counts[b.name]}x ${b.name} (${fmtValue(b.value, null)})`);
    }
  }

  return {
    bestName:    `${counts[best.name]}x ${best.name}`,
    bestValue:   Number(best.value) || 0,
    serverID:    jobId || null,
    allBrainrots:parts.join(', '),
    duel:        duelMode === true || false,
  };
}

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
  if (user.auth_expire !== -1 && user.auth_expire < Math.floor(Date.now() / 1000))
    return { valid: false, reason: "Key has expired" };
  return { valid: true, auth_expire: user.auth_expire };
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function uint32BE(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }
function decrypt(hexStr) {
  const cipher  = Buffer.from(hexStr, 'hex');
  const keyBase = sha256(Buffer.from(ENCRYPTION_KEY, 'utf8'));
  const out     = Buffer.alloc(cipher.length);
  let blockIndex = 0;
  let block = sha256(Buffer.concat([keyBase, uint32BE(0)]));
  for (let i = 0; i < cipher.length; i++) {
    const pos = i % 32;
    if (i > 0 && pos === 0) { blockIndex++; block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)])); }
    out[i] = cipher[i] ^ block[pos];
  }
  return out.toString('utf8');
}
function encrypt(plaintext) {
  const inputBuf = Buffer.from(plaintext, 'utf8');
  const keyBase  = sha256(Buffer.from(ENCRYPTION_KEY, 'utf8'));
  const out      = Buffer.alloc(inputBuf.length);
  let blockIndex = 0;
  let block = sha256(Buffer.concat([keyBase, uint32BE(0)]));
  for (let i = 0; i < inputBuf.length; i++) {
    const pos = i % 32;
    if (i > 0 && pos === 0) { blockIndex++; block = sha256(Buffer.concat([keyBase, uint32BE(blockIndex)])); }
    out[i] = inputBuf[i] ^ block[pos];
  }
  return out.toString('hex');
}

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/api/ip') {
    try {
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const { ip } = await ipRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ip }));
    } catch { res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to fetch IP' })); }
    return;
  }
  if (req.url === '/api/test') {
    try {
      const since = (Date.now() / 1000 - 3600).toFixed(7);
      const railway1Url = `${WORKER_URL}/railway1?since=${since}&_ts=${Date.now()}`;
      const r = await fetch(railway1Url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      const body = await r.text();
      const expected = `https://087uy1728987anghuaga.up.railway.app/get_job?client_id=2519904148&_t=TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm&since=${since}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proxy_url: railway1Url, expected_railway_url: expected, status: r.status, body: body.slice(0, 300) }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  res.writeHead(200); res.end('relay running');
});

const wss = new WebSocket.Server({ server: httpServer });
httpServer.listen(PORT, () => console.log(`✅ WS relay running on port ${PORT}`));

const SESSION_LIMIT_MS = 30 * 60 * 1000;
const activeSessions   = new Map();

function kickExistingSession(key) {
  const old = activeSessions.get(key);
  if (old && old.readyState === WebSocket.OPEN) {
    old.send(JSON.stringify({ error: "Your key connected from another location — disconnecting this session" }));
    old.close(1008, "Replaced by new session");
  }
}

function broadcastFormatted(source, data) {
  const formatted = formatLog(source, data);
  if (!formatted) return;
  const label = source === 'railway-job' ? 'railway job 1'
    : source === 'railway-job-2' ? 'railway job 2'
    : source;
  const payload = encrypt(JSON.stringify({ ...formatted, source: label }));
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) { client.send(payload); count++; }
  });
  console.log(`📤 [${label}] -> ${count} receiver(s) | ${formatted.bestName} ${fmtValue(formatted.bestValue, null)} duel=${formatted.duel}`);
}

setInterval(async () => {
  for (const client of wss.clients) {
    if (!client.authenticated || !client.luarmorKey) continue;
    try {
      const result = await validateLuarmorKey(client.luarmorKey);
      if (!result.valid) {
        console.log(`⏰ Kicking client — ${result.reason}`);
        client.send(JSON.stringify({ error: result.reason }));
        client.close(1008, result.reason);
      }
    } catch { }
  }
}, 5000);

wss.on('connection', (ws) => {
  ws.authenticated = false;
  ws.luarmorKey = null;
  ws.expireTimer = null;
  ws.sessionTimer = null;
  ws.send(JSON.stringify({ info: 'Send {"key":"YOUR_LUARMOR_KEY"} to authenticate' }));

  ws.on('message', async (msg) => {
    if (ws.authenticated) return;
    let data;
    try { data = JSON.parse(msg.toString()); } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" })); ws.close(1008); return;
    }
    if (!data.key) { ws.send(JSON.stringify({ error: "No key provided" })); ws.close(1008); return; }

    try {
      const result = await validateLuarmorKey(data.key);
      if (!result.valid) { ws.send(JSON.stringify({ error: result.reason })); ws.close(1008, result.reason); return; }

      kickExistingSession(data.key);
      activeSessions.set(data.key, ws);

      ws.authenticated = true;
      ws.luarmorKey = data.key;
      ws.send(JSON.stringify({ success: "Authenticated — receiving logs" }));
      console.log(`🔑 Client authenticated`);

      ws.sessionTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: "30-minute session limit reached — reconnect to continue" }));
          ws.close(1008, "Session limit");
          console.log(`⏰ Session limit — disconnected client`);
        }
      }, SESSION_LIMIT_MS);

      if (result.auth_expire !== -1) {
        const ms = (result.auth_expire * 1000) - Date.now();
        if (ms > 0) {
          ws.expireTimer = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ error: "Key expired" })); ws.close(1008); }
          }, ms);
        } else { ws.send(JSON.stringify({ error: "Key has expired" })); ws.close(1008); }
      }
    } catch { ws.send(JSON.stringify({ error: "Validation failed" })); ws.close(1011); }
  });

  ws.on('close', () => {
    if (ws.expireTimer) clearTimeout(ws.expireTimer);
    if (ws.sessionTimer) clearTimeout(ws.sessionTimer);
    if (ws.luarmorKey && activeSessions.get(ws.luarmorKey) === ws) activeSessions.delete(ws.luarmorKey);
  });
});

function connectWsSource(src) {
  let authed = false;
  let retryCount = 0;
  const ws = new WebSocket(src.url);

  ws.on('open', () => {
    retryCount = 0;
    console.log(`✅ [${src.name}] Connected`);
    if (src.authMessage) {
      ws.send(src.authMessage);
      if (src.autoAuth) { authed = true; console.log(`🔑 [${src.name}] Auth sent — auto-authenticated`); }
    } else {
      authed = true;
    }
  });

  ws.on('message', (msg) => {
    const raw = msg.toString();
    let data; try { data = JSON.parse(raw); } catch {}
    if (!authed) {
      if (src.isAuthed && src.isAuthed(data)) { authed = true; console.log(`🔑 [${src.name}] Authenticated`); }
      else console.warn(`⚠️  [${src.name}] Unexpected auth response:`, raw.slice(0, 100));
      return;
    }
    if (src.skipMessage && src.skipMessage(data)) return;

    if (src.name === 'source1' && !data) {
      try {
        const decrypted = decrypt(raw.trim());
        data = JSON.parse(decrypted);
      } catch {
        console.warn(`⚠️  [source1] Failed to decrypt:`, raw.slice(0, 60));
        return;
      }
    }

    broadcastFormatted(src.name, data);
  });

  ws.on('close', (code, reason) => {
    authed = false;
    retryCount++;
    const r = reason?.toString() || 'unknown';
    console.error(`❌ [${src.name}] Disconnected code=${code} reason=${r} (attempt #${retryCount})`);
    if (code === 1008) console.error(`   ↳ Policy violation — bad auth key`);
    if (code === 1006) console.error(`   ↳ Abnormal closure — server may be down`);
    const delay = Math.min(5000 * retryCount, 30000);
    console.log(`⏳ [${src.name}] Reconnecting in ${delay / 1000}s...`);
    setTimeout(() => connectWsSource(src), delay);
  });

  ws.on('error', (err) => {
    authed = false;
    const msg = err.message || String(err);
    console.error(`❌ [${src.name}] Error: ${msg}`);
    if (msg.includes('ECONNREFUSED'))   console.error(`   ↳ Connection refused — is the server running at ${src.url}?`);
    else if (msg.includes('ENOTFOUND')) console.error(`   ↳ Hostname not found — check the URL: ${src.url}`);
    else if (msg.includes('ETIMEDOUT')) console.error(`   ↳ Connection timed out — server unreachable`);
    else if (msg.includes('SSL'))       console.error(`   ↳ SSL/TLS error — check wss:// vs ws://`);
  });
}

function startHttpPoller(src) {
  const concurrency = src.concurrency || 1;
  const staggerMs   = Math.floor(src.intervalMs / concurrency);

  const shared = {
    since:     Date.now() / 1000,
    seenTimes: new Set(),
    maxSeenId: 0,
    failCount: 0,
  };

  async function poll() {
    try {
      const qs = new URLSearchParams(src.params);
      if (src.name !== 'vanishnotifier') {
        qs.set('since', shared.since.toString());
      }
      qs.set('_ts', Date.now().toString());
      const baseUrl = typeof src.url === 'function' ? src.url() : src.url;
      const res = await fetch(`${baseUrl}?${qs}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) {
        shared.failCount++;
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
          if (shared.failCount <= 2) console.warn(`⚠️  [${src.name}] Rate limited (429) — backing off ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
        } else {
          if (shared.failCount <= 3) console.error(`❌ [${src.name}] HTTP ${res.status} (fail #${shared.failCount})`);
        }
        return;
      }
      shared.failCount = 0;
      const text = (await res.text()).trim();
      if (!text.startsWith('{') && !text.startsWith('[')) return;
      const data = JSON.parse(text);

      if (src.name === 'vanishnotifier') {
        if (!data.findings || !Array.isArray(data.findings)) return;
        let newMax = shared.maxSeenId;
        if (shared.maxSeenId === 0 && data.findings.length > 0) {
          console.log(`🔍 [vanishnotifier] keys: ${Object.keys(data.findings[0]).join(', ')}`);
        }
        const sorted = [...data.findings].sort((a, b) => a.id - b.id);
        for (const item of sorted) {
          if (!item.id || item.id <= shared.maxSeenId) continue;
          if (item.id > newMax) newMax = item.id;
          broadcastFormatted(src.name, item);
        }
        shared.maxSeenId = newMax;
        return;
      }

      if (!data.has_job) return;
      const key = data.created_time;
      if (shared.seenTimes.has(key)) return;
      shared.seenTimes.add(key);
      if (shared.since < key + 0.001) shared.since = key + 0.001;
      broadcastFormatted(src.name, data);
    } catch (err) {
      shared.failCount++;
      if (shared.failCount <= 3) console.error(`❌ [${src.name}] Poll error: ${err.message}`);
    }
  }

  async function pollLoop() {
    await poll();
    setTimeout(pollLoop, src.intervalMs);
  }

  for (let i = 0; i < concurrency; i++) {
    setTimeout(pollLoop, i * staggerMs);
  }

  const effectiveMs = Math.round(src.intervalMs / concurrency);
  console.log(`✅ HTTP poller started: ${src.name} → ${typeof src.url === 'function' ? src.url() : src.url} (${concurrency}x workers, ~${effectiveMs}ms effective interval)`);
}

for (const src of WS_SOURCES) connectWsSource(src);
for (const src of HTTP_SOURCES) startHttpPoller(src);
