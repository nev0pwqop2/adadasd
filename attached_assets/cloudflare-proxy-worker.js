export default {
  async fetch(request) {
    const url = new URL(request.url);

    const targets = {
      '/railway1': 'https://087uy1728987anghuaga.up.railway.app/get_job',
      '/railway2': 'https://worker-production-dc68.up.railway.app/get_job',
      '/vanish':   'https://ws.vanishnotifier.org/recent',
    };

    const target = targets[url.pathname];
    if (!target) {
      return new Response('not found', { status: 404 });
    }

    const dest = new URL(target);
    dest.search = url.search;

    const res = await fetch(dest.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://blox-fruits.fandom.com',
        'Referer': 'https://blox-fruits.fandom.com/',
      },
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
