const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const ENCRYPTION_KEY     = "12345678901234567890123456789012";
const LUARMOR_API_KEY    = process.env.LUARMOR_API_KEY;
const LUARMOR_PROJECT_ID = process.env.LUARMOR_PROJECT_ID;
const PORT               = process.env.PORT || 8080;
const WORKER_URL         = process.env.WORKER_URL || "https://calm-night-4622.yohalvata.workers.dev";
const WEBSHARE_PROXY     = process.env.WEBSHARE_PROXY || null;

let proxyFetch = fetch;
if (WEBSHARE_PROXY) {
  try {
    const { ProxyAgent } = require('undici');
    const agent = new ProxyAgent(WEBSHARE_PROXY);
    proxyFetch = (url, opts = {}) => fetch(url, { ...opts, dispatcher: agent });
    console.log(`🌐 Rotating proxy enabled → ${WEBSHARE_PROXY.replace(/:([^@]+)@/, ':***@')}`);
  } catch (e) {
    console.warn('⚠️  undici not available, falling back to Cloudflare proxy');
  }
}


const WS_SOURCES = [
  // source1 temporarily disabled
  // {
  //   name: "source1",
  //   url: "ws://141.11.243.16:4141",
  //   authMessage: JSON.stringify({ auth: "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF" }),
  //   autoAuth: true,
  //   skipMessage: () => false,
  // },
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
    url: () => WEBSHARE_PROXY
      ? 'https://087uy1728987anghuaga.up.railway.app/get_job'
      : `${WORKER_URL}/railway1`,
    extraParams: WEBSHARE_PROXY ? { client_id: '2519904148', _t: 'TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm' } : {},
    params: {},
    intervalMs: 100,
    concurrency: 1,
    useProxyFetch: true,
  },
  {
    name: "railway-job-2",
    url: () => WEBSHARE_PROXY
      ? 'https://worker-production-dc68.up.railway.app/get_job'
      : `${WORKER_URL}/railway2`,
    params: {},
    intervalMs: 2000,
    concurrency: 1,
    useProxyFetch: true,
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
  } else if (source === 'source1' && data?.bestName) {
    let serverID = null;
    if (data.serverID) {
      try { serverID = decryptSource1(data.serverID); } catch { serverID = null; }
    }
    return {
      bestName:    data.bestName,
      bestValue:   Number(data.bestValue) || 0,
      serverID,
      allBrainrots:data.allBrainrots || data.bestName,
      duel:        data.duel === true || data.duel === 1 || false,
    };
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

const SOURCE1_XOR_KEY = Buffer.from('fHZmwC6Nshk82o1od3ohIiGOA7R99JtibXoHO6WvybYK6cLNpn', 'utf8');
function decryptSource1(hexStr) {
  const data = Buffer.from(hexStr, 'hex');
  const out  = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ SOURCE1_XOR_KEY[i % SOURCE1_XOR_KEY.length];
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
  if (req.url === '/api/admin/1234567890') {
    const clients = [];
    wss.clients.forEach(client => {
      const key = client.luarmorKey || null;
      clients.push({
        authenticated: client.authenticated || false,
        key,
        paused: key ? pausedKeys.has(key) : false,
        readyState: ['CONNECTING','OPEN','CLOSING','CLOSED'][client.readyState] || client.readyState,
        pause_url:   key ? `/api/admin/1234567890/pause?key=${encodeURIComponent(key)}`   : null,
        unpause_url: key ? `/api/admin/1234567890/unpause?key=${encodeURIComponent(key)}` : null,
        kick_url:    key ? `/api/admin/1234567890/kick?key=${encodeURIComponent(key)}`    : null,
      });
    });
    const sources = {
      ws: WS_SOURCES.map(s => s.name),
      http: HTTP_SOURCES.map(s => ({ name: s.name, interval: s.intervalMs, url: typeof s.url === 'function' ? s.url() : s.url })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: wss.clients.size, authenticated: clients.filter(c => c.authenticated).length, paused_keys: [...pausedKeys], clients, sources, proxy: WEBSHARE_PROXY ? 'webshare' : 'cloudflare' }, null, 2));
    return;
  }
  if (req.url === '/api/admin/1234567890/pauseall') {
    globalPaused = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ action: 'all_paused', note: 'No logs will be sent to anyone. Visit /resumeall to restore.' }));
    return;
  }
  if (req.url === '/api/admin/1234567890/resumeall') {
    globalPaused = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ action: 'all_resumed', note: 'Logs are flowing again.' }));
    return;
  }
  if (req.url.startsWith('/api/admin/1234567890/pause?') || req.url.startsWith('/api/admin/1234567890/unpause?') || req.url.startsWith('/api/admin/1234567890/kick?')) {
    const u = new URL(req.url, 'http://localhost');
    const key = u.searchParams.get('key');
    if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing key param' })); return; }
    if (u.pathname.endsWith('/pause')) {
      pausedKeys.add(key);
      const client = activeSessions.get(key);
      if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify({ error: 'Your key has been paused by admin' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ action: 'paused', key }));
    } else if (u.pathname.endsWith('/unpause')) {
      pausedKeys.delete(key);
      const client = activeSessions.get(key);
      if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify({ info: 'Your key has been unpaused' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ action: 'unpaused', key }));
    } else if (u.pathname.endsWith('/kick')) {
      pausedKeys.add(key);
      let found = false;
      wss.clients.forEach(client => {
        if (client.luarmorKey === key && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ error: 'Kicked by admin' }));
          client.close(1008, 'Kicked');
          found = true;
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ action: 'kicked', key, was_connected: found, note: 'key also paused — use /unpause to restore' }));
    }
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
      const expected = `https://087uy1728987anghuaga.up.railway.app/get_job?client_id=1&_t=TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm&since=${since}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proxy_url: railway1Url, expected_railway_url: expected, status: r.status, body: body.slice(0, 1000) }));
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
const pausedKeys        = new Set();
const luarmorOrigExpiry = new Map();
let globalPaused        = false;

async function luarmorPatchUser(userKey, body) {
  const res = await fetch(`https://api.luarmor.net/v3/projects/${LUARMOR_PROJECT_ID}/users`, {
    method: 'PATCH',
    headers: { Authorization: LUARMOR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_key: userKey, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Luarmor PATCH ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function luarmorGetUser(userKey) {
  const res = await fetch(
    `https://api.luarmor.net/v3/projects/${LUARMOR_PROJECT_ID}/users?user_key=${encodeURIComponent(userKey)}`,
    { headers: { Authorization: LUARMOR_API_KEY } }
  );
  if (!res.ok) throw new Error(`Luarmor GET ${res.status}`);
  return res.json();
}

async function luarmorPauseKey(userKey) {
  const data = await luarmorGetUser(userKey);
  const original = data.auth_expire ?? -1;
  luarmorOrigExpiry.set(userKey, original);
  await luarmorPatchUser(userKey, { auth_expire: Math.floor(Date.now() / 1000) - 1 });
}

async function luarmorUnpauseKey(userKey) {
  const original = luarmorOrigExpiry.has(userKey) ? luarmorOrigExpiry.get(userKey) : -1;
  await luarmorPatchUser(userKey, { auth_expire: original });
  luarmorOrigExpiry.delete(userKey);
}

function kickExistingSession(key) {
  const old = activeSessions.get(key);
  if (old && old.readyState === WebSocket.OPEN) {
    old.send(JSON.stringify({ error: "Your key connected from another location — disconnecting this session" }));
    old.close(1008, "Replaced by new session");
  }
}

function broadcastPayload(source, formatted) {
  if (globalPaused) return;
  const payload = encrypt(JSON.stringify(formatted));
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated && !pausedKeys.has(client.luarmorKey)) { client.send(payload); count++; }
  });
  console.log(`📤 [${source}] -> ${count} receiver(s) | ${formatted.bestName} ${fmtValue(formatted.bestValue, null)} duel=${formatted.duel}`);
}

function broadcastFormatted(source, data) {
  const formatted = formatLog(source, data);
  if (!formatted) return;
  broadcastPayload(source, formatted);
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


function startHttpPoller(src) {
  const concurrency = src.concurrency || 1;
  const staggerMs   = Math.floor(src.intervalMs / concurrency);

  const shared = {
    since:     Date.now() / 1000,
    seenTimes: new Set(),
    failCount: 0,
  };

  async function poll() {
    try {
      const qs = new URLSearchParams({ ...src.params, ...(src.extraParams || {}) });
      qs.set('since', shared.since.toString());
      qs.set('_ts', Date.now().toString());
      const baseUrl = typeof src.url === 'function' ? src.url() : src.url;
      const fetchFn = (src.useProxyFetch && WEBSHARE_PROXY) ? proxyFetch : fetch;
      const res = await fetchFn(`${baseUrl}?${qs}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) {
        shared.failCount++;
        if (res.status === 429) {
          const retryAfter = Math.max(parseInt(res.headers.get('retry-after') || '3', 10), 3);
          if (shared.failCount === 1 || shared.failCount % 20 === 0)
            console.warn(`⚠️  [${src.name}] 429 rate limit (hit #${shared.failCount}) — backing off ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
        } else {
          if (shared.failCount === 1 || shared.failCount % 20 === 0)
            console.error(`❌ [${src.name}] HTTP ${res.status} (fail #${shared.failCount})`);
        }
        return;
      }
      shared.failCount = 0;
      const text = (await res.text()).trim();
      if (!text.startsWith('{') && !text.startsWith('[')) return;
      const data = JSON.parse(text);

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
        const decrypted = decryptSource1(raw.trim());
        data = JSON.parse(decrypted);
      } catch (e) {
        console.warn(`⚠️  [source1] Failed to decrypt/parse: ${e.message}`);
        return;
      }
    }

    const formatted = formatLog(src.name, data);
    if (!formatted) return;
    broadcastPayload(src.name, formatted);
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

for (const src of WS_SOURCES) connectWsSource(src);
for (const src of HTTP_SOURCES) startHttpPoller(src);
