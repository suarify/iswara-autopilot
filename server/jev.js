import { performance } from "node:perf_hooks";
import {
  CANDIDATE_COUNT,
  decisionSelection,
  stopAvailability,
} from "../src/planning.js";
import { prepareJevRequest, expandJevAnswers } from "../src/jev-request.js";

export function validState(state) {
  if (
    !Number.isFinite(state?.speed_mps) ||
    !Number.isFinite(state?.speed_ceiling_mps) ||
    state.speed_ceiling_mps < 0 ||
    state.speed_ceiling_mps > 28 ||
    !/^b[0-9]+$/.test(state.batch_id) ||
    typeof state.road?.on_road !== "boolean" ||
    typeof state.recovery?.active !== "boolean" ||
    !state.vectors ||
    !state.turn
  )
    return false;
  const entries = Object.entries(state.vectors);
  return (
    entries.length > 0 &&
    entries.length <= CANDIDATE_COUNT &&
    entries.every(
      ([id, v]) =>
        v &&
        id.startsWith(`${state.batch_id}_`) &&
        /^[a-zA-Z0-9_]+$/.test(id) &&
        (v.lane_offset_m === null ||
          (Number.isFinite(v.lane_offset_m) &&
            Math.abs(v.lane_offset_m) <= 1.4 &&
            Number.isFinite(v.lookahead_m) &&
            v.lookahead_m >= 2 &&
            v.lookahead_m <= 10)) &&
        Number.isFinite(v.steering) &&
        Math.abs(v.steering) <= 0.85 &&
        Number.isFinite(v.velocity_mps) &&
        (v.stop_at_line == null ||
          (Number.isFinite(v.lane_offset_m) &&
            ["x", "z", "heading", "clearance_m", "deceleration_mps2"].every(
              (key) => Number.isFinite(v.stop_at_line[key]),
            ) &&
            v.stop_at_line.clearance_m === 0.5 &&
            v.stop_at_line.deceleration_mps2 >= 4 &&
            v.stop_at_line.deceleration_mps2 <= 4.8)) &&
        v.velocity_mps >= (state.recovery.active ? -2 : 0) &&
        Math.abs(v.velocity_mps) <= state.speed_ceiling_mps + 0.001 &&
        typeof v.collision_predicted === "boolean" &&
        typeof v.stays_on_road === "boolean" &&
        Number.isFinite(v.route_error_m) &&
        Number.isFinite(v.offroad_fraction),
    ) &&
    (!stopAvailability(state).available ||
      entries.some(([, v]) => v.velocity_mps === 0))
  );
}

export function questions(state) {
  return prepareJevRequest(state).request.questions;
}
export async function evaluate(state, env, signal, onUsage, apiKey) {
  if (!validState(state)) {
    const error = new Error(
      "A valid driving observation and candidate batch are required.",
    );
    error.status = 400;
    throw error;
  }
  // A key pasted into the frontend (x-jev-key header) wins for this call;
  // otherwise the server-wide TYPESAFE_API_KEY applies. The key is only
  // ever forwarded to api.typesafe.ai, never logged or echoed back.
  const key = apiKey || env.TYPESAFE_API_KEY;
  const start = performance.now();
  const prepared = prepareJevRequest(state);
  const requestQuestions = prepared.request.questions;
  const body = JSON.stringify(prepared.request);
  const apiCall = Object.keys(requestQuestions).length > 0;
  let data = { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
  if (apiCall) {
    if (!key) {
      const error = new Error(
        "No Jev API key. Enter one in the frontend or set TYPESAFE_API_KEY in .env.",
      );
      error.status = 503;
      throw error;
    }
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: signal || AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const error = new Error(
        res.status === 401
          ? "Jev rejected the API key — please check your key."
          : res.status === 429
            ? "Jev rate limit reached. Pausing before retry."
            : `Jev API returned HTTP ${res.status}.`,
      );
      error.status = res.status;
      error.billable = res.status >= 500;
      throw error;
    }
    data = await res.json();
  }
  // Account for paid responses even when their decision later fails validation.
  if (onUsage) await onUsage(data.usage);
  const a = expandJevAnswers(prepared, data.answers);
  const selection = decisionSelection(state, a);
  if (
    !selection ||
    !Number.isFinite(data.usage?.input_tokens) ||
    !Number.isFinite(data.usage?.output_tokens)
  )
    throw new Error("Jev returned an incomplete decision.");
  if (
    requestQuestions.route &&
    !Object.hasOwn(requestQuestions.route.criteria, a.route?.choice)
  )
    throw new Error("Jev returned an invalid route choice.");
  const selected = state.vectors[selection.choice];
  if (
    (selected.collision_imminent ?? selected.collision_predicted) &&
    selected.velocity_mps !== 0
  )
    throw new Error(
      "Jev selected a path with an imminent collision. Braking before retry.",
    );
  const inputPrice = Number(env.JEV_INPUT_PRICE ?? 0.042),
    outputPrice = Number(env.JEV_OUTPUT_PRICE ?? 0);
  return {
    model: data.model ?? null,
    decision_source: apiCall ? "jev" : "only_eligible_action",
    request_bytes: apiCall ? Buffer.byteLength(body) : 0,
    candidate_ids: prepared.aliases,
    resolved_single_choices: Object.keys(prepared.fixed),
    answers: a,
    selection,
    batch_id: state.batch_id,
    controls: { steering: selected.steering, velocity: selected.velocity_mps },
    usage: data.usage,
    latency_ms: Math.round(performance.now() - start),
    cost_usd:
      (data.usage.input_tokens * inputPrice +
        data.usage.output_tokens * outputPrice) /
      1e6,
    pricing: {
      input_per_million: inputPrice,
      output_per_million: outputPrice,
      source: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
    },
  };
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
    // .env edit is needed; it falls back to the server-wide key.
    const headerKey = req.headers["x-jev-key"];
    const clientKey =
      typeof headerKey === "string" && headerKey.length <= 200
        ? headerKey.trim() || null
        : null;
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return send(403, { error: "Origin not allowed" });
    if (path === "/api/key-check") {
      // Cheap auth probe: an empty payload is rejected for its shape (400)
      // when the key is fine, and with 401 only when the key is bad.
      // Never echoes the key back.
      const key = clientKey || env.TYPESAFE_API_KEY;
      if (!key)
        return send(200, { ok: false, error: "No key provided." });
      try {
        const probe = await fetch("https://api.typesafe.ai/v1/systemone", {
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
            error: "TypeSafe rejected this key (401). Check for typos or grab a fresh one.",
          });
        return send(200, { ok: true });
      } catch (e) {
        return send(200, {
          ok: false,
          error:
            e.name === "TimeoutError"
              ? "TypeSafe timed out — try again."
              : "Could not reach TypeSafe.",
        });
      }
    }
    if (!env.TYPESAFE_API_KEY && !clientKey)
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
      const result = await evaluate(state, env, undefined, undefined, clientKey);
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
