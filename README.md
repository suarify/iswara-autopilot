# JevPilot — Kancil Autopilot (Pure Frontend)

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

<p align="center">
  <a href="https://jevpilot.standardagents.ai">
    <img src="docs/try-jevpilot.svg" alt="Try JevPilot →" width="256" height="64" />
  </a>
</p>

**Play now:** [GH Pages — suarify.github.io/kancil-autopilot](https://suarify.github.io/kancil-autopilot/) · [here.now — rustic-breeze-p5bt](https://rustic-breeze-p5bt.here.now/) · Upstream [jevpilot.standardagents.ai](https://jevpilot.standardagents.ai)

> **Self-host brains (Kev / Laya):** local Jev alternatives at **[suarify/jev-kev-laya-selfhost](https://github.com/suarify/jev-kev-laya-selfhost)** — run `http://localhost:8080/v1/drive` (or your tunnel) and paste the URL in **Pick your driver** with **Call straight from this browser** checked. See that repo for Docker, CORS and model weights.

Pure frontend driving playground — no server. Manual driving, Myvi/Wira/Tesla/Satria chase, race timer, finish gate, and optional Jev autopilot directly from the browser.

## Quick start (static)

```sh
npm ci
npm run dev      # http://localhost:5173
# build for any static host
npm run build    # -> dist/
npx serve dist -l 5000
# or: python -m http.server 5000 --directory dist
```

No `.env`, no `wrangler`, no login. `J` toggles autopilot.

## Jev autopilot (optional, browser-direct)

Click the **key** icon, paste your [TypeSafe AI](https://typesafe.ai/) key (stored in `localStorage` only), or **Pick your driver** → paste a direct brain URL (e.g. `http://localhost:8080/v1/drive` or `https://api.typesafe.ai/v1/systemone`) with **Call straight from this browser** checked. The browser calls the brain directly — `src/jev-client.js:70` `evaluateBrain()` — no proxy.

Direct brains need CORS for this origin. For local **Kev** / **Laya** self-host, see **[suarify/jev-kev-laya-selfhost](https://github.com/suarify/jev-kev-laya-selfhost)** — clone, `docker compose up`, expose via `cloudflared tunnel` if needed, then use the `https://*.trycloudflare.com/v1/drive` URL.

## How it works

Compact candidate tables (eligible steering+speed vectors, road bounds, traffic, signals) are sampled locally (`src/planning.js`, `src/driving-plan.js`). Jev picks the vector; physics, collisions `src/collisions.js`, and 3D `src/scene.js` + `src/model-assets.js` (hero `Satria`/`Kancil`/`Myvi`/`Wira`/`Bezza`/`Tesla`, traffic fleet `src/simulation.js:76`) stay client-side.

Timer `src/main.js:1773`, checkered finish `src/scene.js:793`, violations modal `src/main.js:1795` and 2-line `MYVI GANG` banner `src/main.js:1759` are all frontend.

## Deploy static

Upload `dist/` to GitHub Pages / Netlify / Cloudflare Pages. No functions. See `docs/hosting.md`.

Asset credits in `public/`.

## Attribution

Original **JevPilot** by [StandardAgents](https://github.com/standardagents/jevpilot) (https://jevpilot.standardagents.ai) — Tesla Autopilot-like demo using [Jev by TypeSafe AI](https://typesafe.ai/). Upstream MIT-style assets, traffic GLB fleet and world simulation by the original authors.

This fork **Kancil Autopilot** (`suarify/kancil-autopilot`) is a pure-frontend static adaptation maintained by **Suarify** — adds `Satria` hero/traffic (`public/models/model-y/satria.glb` `src/model-assets.js:82`), race timer + checkered finish (`src/main.js:1773` `src/scene.js:793`), 3-violations dialog (`src/main.js:1795`), 2-line `MYVI GANG` banner (`src/main.js:1759`), and client-side Jev direct (`src/jev-client.js:70` `src/main.js:1957`). Original credits preserved; upstream remains at `standardagents/jevpilot`.
