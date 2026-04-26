const WebSocket = require('/home/runner/workspace/node_modules/.pnpm/ws@8.20.0/node_modules/ws/index.js');

const URL = 'wss://ws.vanishnotifier.org/ws?token=VnshWS-0Nf3FqsuR3A0UpXIZtafGGUzj-hQ1QLj';

console.log('Connecting to vanishnotifier...');

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[CONNECTED] Waiting for messages — press Ctrl+C to stop\n');
});

ws.on('message', (raw) => {
  const str = raw.toString();
  console.log('--- RAW ---');
  console.log(str);
  try {
    const parsed = JSON.parse(str);
    console.log('--- PARSED ---');
    console.log(JSON.stringify(parsed, null, 2));
  } catch {}
  console.log('');
});

ws.on('error', (e) => {
  console.error('[ERROR]', e.message);
});

ws.on('close', (code, reason) => {
  console.log(`[CLOSED] code=${code} reason=${reason?.toString()}`);
});
