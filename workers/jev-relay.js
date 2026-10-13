// jev-relay: thin CORS relay for the TypeSafe System One API.
//
// Static hosting (GitHub Pages) cannot call api.typesafe.ai directly until
// our origin is allowlisted there, so the Pages build calls this worker
// instead (VITE_JEV_ENDPOINT=https://<this-worker>/v1/systemone).
// The visitor's API key stays in their browser: it is forwarded upstream,
// never stored or logged here. Only the auth + content-type headers and the
// JSON body are forwarded; everything else is dropped.
//
// Deploy once (needs a Cloudflare account):
//   cd workers && npx wrangler login && npx wrangler deploy
const UPSTREAM = "https://api.typesafe.ai";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

export default {
  async fetch(req) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const upstream = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers();
    const auth = req.headers.get("authorization");
    if (auth) headers.set("authorization", auth);
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const upstreamRes = await fetch(upstream, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    });
    const out = new Headers(upstreamRes.headers);
    for (const [name, value] of Object.entries(CORS)) out.set(name, value);
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: out,
    });
  },
};
