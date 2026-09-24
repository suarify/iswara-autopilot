// Browser-safe Jev decision call. No node imports: the same code runs the
// in-browser direct path and (via server/jev.js) the proxy path.
import {
  CANDIDATE_COUNT,
  decisionSelection,
  stopAvailability,
} from "./planning.js";
import { prepareJevRequest, expandJevAnswers } from "./jev-request.js";

export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

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

// Full decision round-trip against any compatible brain endpoint.
// options: { apiKey, endpoint, model, inputPrice, outputPrice,
//   signal, onUsage, lenientUsage }
export async function evaluateBrain(state, options = {}) {
  if (!validState(state)) {
    const error = new Error(
      "A valid driving observation and candidate batch are required.",
    );
    error.status = 400;
    throw error;
  }
  const {
    apiKey = null,
    endpoint = DEFAULT_ENDPOINT,
    model = "jev-latest",
    inputPrice = 0.042,
    outputPrice = 0,
    signal = null,
    onUsage = null,
    lenientUsage = false,
  } = options;
  const start = performance.now();
  const prepared = prepareJevRequest(state);
  const requestQuestions = prepared.request.questions;
  const body = JSON.stringify({ ...prepared.request, model });
  const apiCall = Object.keys(requestQuestions).length > 0;
  // The shared TypeSafe endpoint strictly requires a key; self-hosted
  // brains (like the keyless :8009 example) may skip auth entirely.
  const customBrain = endpoint !== DEFAULT_ENDPOINT;
  let data = { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
  if (apiCall) {
    if (!apiKey && !customBrain) {
      const error = new Error(
        "No API key. Enter one in the frontend first.",
      );
      error.status = 503;
      throw error;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
            ? "Rate limit reached. Pausing before retry."
            : `Brain API returned HTTP ${res.status}.`,
      );
      error.status = res.status;
      error.billable = res.status >= 500;
      throw error;
    }
    data = await res.json();
    // Self-hosted brains may skip usage accounting; default to zeros
    // instead of failing the whole decision when lenient.
    if (
      lenientUsage &&
      (!Number.isFinite(data.usage?.input_tokens) ||
        !Number.isFinite(data.usage?.output_tokens))
    )
      data.usage = { input_tokens: 0, output_tokens: 0 };
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
  return {
    model: data.model ?? null,
    brain_model: model,
    decision_source: apiCall ? "jev" : "only_eligible_action",
    request_bytes: apiCall
      ? new TextEncoder().encode(body).length
      : 0,
    candidate_ids: prepared.aliases,
    resolved_single_choices: Object.keys(prepared.fixed),
    answers: a,
    selection,
    batch_id: state.batch_id,
    controls: { steering: selected.steering, velocity: selected.velocity_mps },
    usage: data.usage,
    latency_ms: Math.round(performance.now() - start),
    cost_usd:
      (data.usage.input_tokens * Number(inputPrice) +
        data.usage.output_tokens * Number(outputPrice)) /
      1e6,
    pricing: {
      input_per_million: Number(inputPrice),
      output_per_million: Number(outputPrice),
    },
  };
}
