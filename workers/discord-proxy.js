/**
 * Cloudflare Worker — Discord API Proxy
 *
 * Deploy this worker and set the URL as DISCORD_REST_PROXY in Render.
 * It forwards all requests to discord.com, bypassing IP-level bans on shared hosts.
 *
 * Deploy steps:
 *   1. Go to https://workers.cloudflare.com and create a new Worker
 *   2. Paste this entire file as the worker code
 *   3. Save & deploy — copy the worker URL (e.g. https://discord-proxy.yourname.workers.dev)
 *   4. In Render → Environment, add:
 *        DISCORD_REST_PROXY = https://discord-proxy.yourname.workers.dev
 *   5. Trigger a redeploy on Render
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const targetUrl = new URL(
      url.pathname + url.search,
      "https://discord.com"
    );

    const headers = new Headers(request.headers);
    headers.set("host", "discord.com");

    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    });

    const response = await fetch(proxyRequest);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("access-control-allow-origin", "*");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
