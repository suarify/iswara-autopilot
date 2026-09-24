# Static hosting

This branch is **pure frontend** — no Worker, no `server/`, no `wrangler.jsonc`.

## Build

```sh
npm run build # -> dist/
```

## Deploy anywhere static

- **GitHub Pages:** upload `dist/` (or `npx gh-pages -d dist`)
- **Netlify / Vercel:** build `npm run build`, publish `dist`
- **Cloudflare Pages:** `Pages` project, build `npm run build`, output `dist`
- **Any:** `python -m http.server 5000 --directory dist` or `npx serve dist`

No secrets, no env. Jev autopilot (optional) runs **directly from the browser** to `api.typesafe.ai` or your self-hosted brain URL (needs CORS). Paste the key via the key icon — stored in `localStorage`.

To restore server + OAuth + $0.25 credit gate, checkout `feature/backup-dirty` (`server/worker.js`, `wrangler.jsonc`, `login.html`).
