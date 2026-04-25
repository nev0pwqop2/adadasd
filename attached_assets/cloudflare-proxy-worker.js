export default {
  async fetch(request) {
    const url = new URL(request.url);

    const RAILWAY1_TARGET = 'https://087uy1728987anghuaga.up.railway.app/get_job';
    const CLIENT_IDS = { '/railway1': '2519904148', '/railway1a': '1', '/railway1b': '2' };

    if (url.pathname in CLIENT_IDS) {
      const dest = new URL(RAILWAY1_TARGET);
      dest.searchParams.set('client_id', CLIENT_IDS[url.pathname]);
      dest.searchParams.set('_t', 'TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm');
      if (url.searchParams.has('since')) dest.searchParams.set('since', url.searchParams.get('since'));
      if (url.searchParams.has('_ts'))   dest.searchParams.set('_ts',   url.searchParams.get('_ts'));

      const res = await fetch(dest.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://blox-fruits.fandom.com',
          'Referer': 'https://blox-fruits.fandom.com/',
        },
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/railway2') {
      const dest = new URL('https://worker-production-dc68.up.railway.app/get_job');
      for (const [k, v] of url.searchParams) dest.searchParams.set(k, v);
      const res = await fetch(dest.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://blox-fruits.fandom.com',
          'Referer': 'https://blox-fruits.fandom.com/',
        },
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/vanish') {
      const dest = new URL('https://ws.vanishnotifier.org/recent');
      for (const [k, v] of url.searchParams) dest.searchParams.set(k, v);
      const res = await fetch(dest.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://blox-fruits.fandom.com',
          'Referer': 'https://blox-fruits.fandom.com/',
        },
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response('not found', { status: 404 });
  },
};
