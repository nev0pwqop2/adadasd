const WebSocket = require('ws');

const SENDER_AUTH_KEY = "6767";
const ENCRYPTION_KEY  = "12345678901234567890123456789012";
const PORT            = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });
console.log(`WS relay running on port ${PORT}`);

function xorEncrypt(text, key) {
  const textBytes = Buffer.from(text, 'utf8');
  const keyBytes  = Buffer.from(key, 'utf8');
  const result    = Buffer.alloc(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    result[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return result.toString('hex');
}

function encrypt(plaintext) {
  return xorEncrypt(plaintext, ENCRYPTION_KEY);
}

function broadcastToReceivers(payload) {
  const encrypted = encrypt(JSON.stringify(payload));
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.role === 'receiver') {
      client.send(encrypted);
      count++;
    }
  });
  console.log(`Broadcast -> ${count} receiver(s)`);
}

function normalizeAuthFromUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith('/auth/')) return "";
  const noQuery = rawUrl.split('?')[0];
  const tokenPart = noQuery.slice('/auth/'.length).replace(/\/+$/, '');
  try { return decodeURIComponent(tokenPart); } catch { return tokenPart; }
}

wss.on('connection', (ws, req) => {
  ws.role = null;

  if (req.url && req.url.startsWith('/auth/')) {
    const provided = normalizeAuthFromUrl(req.url);
    if (provided === SENDER_AUTH_KEY) {
      ws.role = 'sender';
      ws.send(JSON.stringify({ success: 'Sender authenticated', role: 'sender' }));
    } else {
      ws.role = 'receiver';
      ws.send(JSON.stringify({ success: 'Connected', role: 'receiver' }));
    }
    bindMessageHandler(ws);
    return;
  }

  ws.role = 'receiver';
  ws.send(JSON.stringify({ success: 'Connected', role: 'receiver' }));
  bindMessageHandler(ws);
});

function bindMessageHandler(ws) {
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { ws.send(JSON.stringify({ error: 'Invalid JSON' })); return; }

    if (ws.role === null) {
      if (data.auth === SENDER_AUTH_KEY) {
        ws.role = 'sender';
        ws.send(JSON.stringify({ success: 'Sender authenticated', role: 'sender' }));
        return;
      }
      ws.role = 'receiver';
      ws.send(JSON.stringify({ success: 'Connected', role: 'receiver' }));
      return;
    }

    if (ws.role === 'sender') { broadcastToReceivers(data); return; }
    ws.send(JSON.stringify({ info: 'You are a receiver' }));
  });

  ws.on('close', () => console.log('Client disconnected'));
}
