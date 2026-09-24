import { performance } from "node:perf_hooks";
import {
  CANDIDATE_COUNT,
  decisionSelection,
  stopAvailability,
} from "../src/planning.js";
import { prepareJevRequest, expandJevAnswers } from "../src/jev-request.js";
import {
  validState,
  questions,
  evaluateBrain,
  DEFAULT_ENDPOINT,
} from "../src/jev-client.js";

export { validState, questions };
// Custom brain endpoint comes from a request header (local Vite dev only).
// Allow-any mode: any http(s) URL is accepted. Credentials in the URL are
// still rejected. Cross-site abuse is contained by the Origin check in
// jevMiddleware below (same-host origin required).
export const DEFAULT_ALLOWED_BRAIN_HOSTS = [];

export function parseAllowedBrainHosts(env = {}) {
  const raw = env.JEV_ALLOWED_BRAIN_HOSTS;
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function brainHostAllowed() {
  return true;
}

export function resolveBrainEndpoint(raw) {
  if (!raw) return null;
  if (typeof raw !== "string" || raw.length > 500) return "invalid";
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return "invalid";
  }
  if (url.username || url.password) return "invalid";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid";
  if (!url.hostname) return "invalid";
  return url.toString();
}

export function resolveBrainModel(raw) {
  if (!raw) return null;
  if (typeof raw !== "string") return "invalid";
  const name = raw.trim().slice(0, 64);
  return name || null;
}

export async function evaluate(
  state,
  env,
  signal,
  onUsage,
  apiKey,
  brainEndpoint,
  brainModel,
) {
  // Shared browser-safe core; the server only adds env pricing/defaults.
  // Lenient usage stays scoped to self-hosted brains (hosted billing
  // still requires valid usage via onUsage).
  return evaluateBrain(state, {
    apiKey: apiKey || env.TYPESAFE_API_KEY,
    endpoint: brainEndpoint || DEFAULT_ENDPOINT,
    model: brainModel || "jev-latest",
    inputPrice: Number(env.JEV_INPUT_PRICE ?? 0.042),
    outputPrice: Number(env.JEV_OUTPUT_PRICE ?? 0),
    signal,
    onUsage,
    lenientUsage: !!brainEndpoint,
  });
}
export function jevMiddleware(env) {
  // Mounted only by Vite dev/preview. The deployed Worker always requires login.
  let active = 0;
  return async (req, res, next) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (["/login", "/login.html"].includes(path) && req.method === "GET") {
      res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
      return res.end();
    }
    if (!path.startsWith("/api/")) return next();
    const send = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (path === "/api/status" && req.method === "GET")
      return send(200, {
        auth_required: false,
        authenticated: false,
        configured: !!env.TYPESAFE_API_KEY,
        model: "jev-latest",
        pricing: {
          input_per_million: Number(env.JEV_INPUT_PRICE ?? 0.042),
          output_per_million: Number(env.JEV_OUTPUT_PRICE ?? 0),
        },
      });
    if (path !== "/api/decide" && path !== "/api/key-check")
      return send(404, { error: "Not found" });
    if (req.method !== "POST") return send(404, { error: "Not found" });
    // Local dev accepts a per-browser key via the x-jev-key header so no
    // .env edit is needed; it falls back to the server-wide key. A custom
    // self-hosted brain rides x-jev-endpoint (localhost only) + x-jev-model.
    const headerKey = req.headers["x-jev-key"];
    const clientKey =
      typeof headerKey === "string" && headerKey.length <= 200
        ? headerKey.trim() || null
        : null;
    const brainEndpoint = resolveBrainEndpoint(req.headers["x-jev-endpoint"]);
    const brainModel = resolveBrainModel(req.headers["x-jev-model"]);
    if (brainEndpoint === "invalid" || brainModel === "invalid")
      return send(400, {
        error:
          "Bad brain override. Endpoint must be an http(s) URL, model a short name.",
      });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return send(403, { error: "Origin not allowed" });
    if (path === "/api/key-check") {
      // Cheap auth probe: an empty payload is rejected for its shape (400)
      // when the key is fine, and with 401 only when the key is bad.
      // Probes the overridden brain when one is given. Never echoes keys.
      const key = clientKey || env.TYPESAFE_API_KEY;
      const endpoint =
        brainEndpoint || "https://api.typesafe.ai/v1/systemone";
      if (!key)
        return send(200, { ok: false, error: "No key provided." });
      try {
        const probe = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(10000),
        });
        if (probe.status === 401)
          return send(200, {
            ok: false,
            error: "That endpoint rejected this key (401). Check for typos or grab a fresh one.",
          });
        return send(200, { ok: true });
      } catch (e) {
        return send(200, {
          ok: false,
          error:
            e.name === "TimeoutError"
              ? "Endpoint timed out — is it running?"
              : "Could not reach that endpoint.",
        });
      }
    }
    if (!env.TYPESAFE_API_KEY && !clientKey && !brainEndpoint)
      return send(503, {
        error:
          "No Jev API key. Tap the key button and paste yours, or set TYPESAFE_API_KEY in .env and restart.",
      });
    if (active >= 3)
      return send(429, { error: "Too many active Jev requests." });
    active++;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 250000) {
          send(413, { error: "State is too large" });
          return;
        }
      }
      const { state } = JSON.parse(body);
      if (!validState(state))
        return send(400, {
          error:
            "A valid driving observation and candidate batch are required.",
        });
      const result = await evaluate(
        state,
        env,
        undefined,
        undefined,
        clientKey,
        brainEndpoint,
        brainModel,
      );
      send(200, result);
    } catch (e) {
      send(e.status || 502, {
        error:
          e.name === "TimeoutError"
            ? "Jev timed out. Car stopped; retrying."
            : e.message,
      });
    } finally {
      active--;
    }
  };
}
