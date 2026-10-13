# Iswara Pilot — JevPilot fork (Pure Frontend)

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

<p align="center">
  <a href="https://jevpilot.standardagents.ai">
    <img src="docs/try-jevpilot.svg" alt="Try JevPilot →" width="256" height="64" />
  </a>
</p>

**Play now:** [GH Pages — suarify.github.io/iswara-autopilot](https://suarify.github.io/iswara-autopilot/) · [here.now — rustic-breeze-p5bt](https://rustic-breeze-p5bt.here.now/) · Upstream [jevpilot.standardagents.ai](https://jevpilot.standardagents.ai)

> **Self-host brains (Kev / Laya):** local Jev alternatives at **[suarify/jev-kev-laya-selfhost](https://github.com/suarify/jev-kev-laya-selfhost)** — run `http://localhost:8080/v1/drive` (or your tunnel) and paste the URL in **Pick your driver** with **Call straight from this browser** checked. See that repo for Docker, CORS and model weights.

Pure frontend driving playground — no server. Manual driving, Myvi/Wira/Tesla/Satria chase, race timer, finish gate, and optional autopilot (**Jev** or **OpenAI Decisions**) called straight from the browser tab.

## Quick start (static)

```sh
npm ci
npm run dev      # http://localhost:5173
npm test         # node --test tests/*.test.js
# build for any static host
npm run build    # -> dist/
npx serve dist -l 5000
# or: python -m http.server 5000 --directory dist
```

No `.env` or login for local dev (`wrangler` only to deploy the optional Pages relay below). `J` toggles autopilot.

## Autopilot: bring your own key (Jev **or** OpenAI)

The **key** icon opens **Use your own key.** (`src/main.js:158`) with a provider switch:

| Provider | Endpoint | Model | Price used by the inspector |
| --- | --- | --- | --- |
| **Jev API (TypeSafe)** | `https://api.typesafe.ai/v1/systemone` (`src/jev-client.js:19`), or the relay when `VITE_JEV_ENDPOINT` is set | `jev-latest` | server pricing, `$0.042`/1M fallback in static mode |
| **OpenAI Decisions API** | `https://api.openai.com/v1/decisions` (`src/openai-adapter.js:15`) | `gpt-6-luna` default, or any model you pick | **$0.10 / 1M input, $0 output** (`src/openai-adapter.js:18`) |

- Keys stay in `localStorage` only — `jevpilot.jev_api_key`, `jevpilot.openai_api_key`, `jevpilot.openai_model`, `jevpilot.key_provider` — and are sent **only** to the provider you chose, or to your own configured relay (dev `/typesafe` proxy, or your worker), which forwards them untouched.
- **List models** (`src/main.js:1154`) calls `GET https://api.openai.com/v1/models` with your key (it doubles as the key check: 401/403 = bad key) and fills the model dropdown; decision-capable models float to the top.
- The driving pipeline is unchanged. `src/openai-adapter.js` translates our local candidate-table questions into OpenAI's `{model, input, questions}` body (`buildOpenAIBody`) and folds the `answers` back into the same shape the planner scores (`fromOpenAIAnswers` — zero-fills missing options and clamps to a valid probability distribution, and only reports refusals for questions we actually asked).
- `src/jev-client.js:96` `evaluateBrain()` picks the transport per provider; the inspector shows `decision_source: "openai"` (`src/jev-client.js:212`).
- Static hosting has no `/api/*`, so decisions run directly from the tab (`src/main.js:1541`) — no server round trip.

**Direct brains:** **Pick your driver** → paste a brain URL (e.g. `http://localhost:8080/v1/drive` or `https://api.typesafe.ai/v1/systemone`) with **Call straight from this browser** checked. Direct brains need CORS for this origin. For local **Kev** / **Laya** self-host, see **[suarify/jev-kev-laya-selfhost](https://github.com/suarify/jev-kev-laya-selfhost)** — clone, `docker compose up`, expose via `cloudflared tunnel` if needed, then use the `https://*.trycloudflare.com/v1/drive` URL.

**Jev relay (CORS workaround):** TypeSafe only allowlists `console.typesafe.ai`, so browsers elsewhere get `400 Disallowed CORS origin` on the preflight. Two relays bridge it — same request format, key still only in your browser:
- **Dev:** `vite.config.js` proxies `/typesafe/*` → `api.typesafe.ai`; `npm run dev` uses it automatically (`VITE_JEV_ENDPOINT` overrides).
- **Pages:** deploy `workers/jev-relay.js` once (`cd workers && npx wrangler login && npx wrangler deploy`), then build with `VITE_JEV_ENDPOINT=https://jev-relay.<you>.workers.dev/v1/systemone` (CI reads the repo variable `VITE_JEV_ENDPOINT`).

## Tests

```sh
npm test   # node --test tests/*.test.js
```

> Note: the full run currently stalls inside `tests/simulation.test.js` (pre-existing hang in world-sim code, unrelated to autopilot). Run files individually instead, e.g. `node --test tests/jev-client.test.js tests/openai-adapter.test.js`.

Covers world generation, physics, collisions, chase/traffic behaviour, road recovery, voice commands, and both provider layers — `tests/jev-client.test.js` and `tests/openai-adapter.test.js` (Jev ↔ OpenAI request/response translation).

Known red, all pre-existing and outside the autopilot path: 10 assertions in `chase` (2) / `simulation` (4) / `traffic-safety` (3) / `road-recovery` (1) that predate the current world build. The old `server/` test files (`auth`, `jev`) were removed with the server itself.

## How it works

Compact candidate tables (eligible steering+speed vectors, road bounds, traffic, signals) are sampled locally (`src/planning.js`, `src/driving-plan.js`). The chosen provider picks the vector; physics, collisions `src/collisions.js`, and 3D `src/scene.js` + `src/model-assets.js` (heroes from `src/model-assets.js:121`, traffic fleet from `src/model-assets.js:82`, specs in `src/simulation.js`) stay client-side.

Race timer `src/main.js:149`, checkered finish `src/scene.js:805`, violations dialog `src/main.js:1257` and 2-line `MYVI GANG` banner `src/main.js:1912` are all frontend.

## Deploy static

Push to `main` — `.github/workflows/deploy.yml` runs `npm run build` and publishes `dist/` to the `gh-pages` branch. Or locally:

```sh
npm run build
npx gh-pages -d dist
```

Netlify / Cloudflare Pages: build `npm run build`, publish `dist`. No functions. See `docs/hosting.md`.

Asset credits in `public/`.

## Attribution

Original **JevPilot** by [StandardAgents](https://github.com/standardagents/jevpilot) (https://jevpilot.standardagents.ai) — Tesla Autopilot-like demo using [Jev by TypeSafe AI](https://typesafe.ai/). Upstream MIT-style assets, traffic GLB fleet and world simulation by the original authors.

This fork **Iswara Pilot** (`suarify/iswara-autopilot`) is a pure-frontend static adaptation maintained by **Suarify** — adds the `Satria` hero/traffic car (`public/models/model-y/satria.glb`), race timer + checkered finish, the 3-violations dialog, the 2-line `MYVI GANG` banner, browser-direct Jev (`src/jev-client.js:81`), and the **OpenAI Decisions** provider (`src/openai-adapter.js`). Original credits preserved; upstream remains at `standardagents/jevpilot`.
