// Minimal local Kev brain — heuristic stub that actually drives.
// Listens on http://localhost:8009/v1/systemone (and /v1/drive).
// Protocol: POST { model, state, questions } ->
//   { model, answers: { <qid>: { type:"choice", choice, probabilities } },
//     usage: { input_tokens, output_tokens } }
// Picks drive when offered, else stop; picks fastest candidate vector.
import { createServer } from "node:http";

const PORT = Number(process.env.KEV_PORT || 8009);

function pickMotion(criteria) {
  const ids = Object.keys(criteria || {});
  if (!ids.length) return null;
  const choice = ids.includes("drive") ? "drive" : ids[0];
  return {
    type: "choice",
    choice,
    probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
  };
}

function pickVector(criteria, state) {
  const ids = Object.keys(criteria || {});
  if (!ids.length) return null;
  // state.candidates: { columns:[...], rows:{ vN:[...] } } — find speed col.
  let choice = ids[0];
  try {
    const c = state?.candidates;
    const cols = c?.columns || [];
    const rows = c?.rows || {};
    const speedIdx = cols.indexOf("speed");
    if (speedIdx >= 0 && rows[choice] !== undefined) {
      let best = -Infinity;
      for (const id of ids) {
        const row = Array.isArray(rows) ? null : rows[id];
        const s = Array.isArray(row) ? row[speedIdx] : null;
        if (typeof s === "number" && s > best) {
          best = s;
          choice = id;
        }
      }
    }
  } catch {}
  const n = ids.length;
  return {
    type: "choice",
    choice,
    probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
    _note: `kev heuristic, ${n} options`,
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method !== "POST" || !url.pathname.startsWith("/v1/")) {
    res.writeHead(404, { "Content-Type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: "Not found. POST /v1/systemone" }));
  }
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 500000) req.destroy();
  });
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json", ...cors });
      return res.end(JSON.stringify({ error: "Invalid JSON." }));
    }
    const { model, state, questions } = parsed;
    const answers = {};
    for (const [qid, q] of Object.entries(questions || {})) {
      if (qid === "motion") answers.motion = pickMotion(q?.criteria);
      else if (qid === "vector") answers.vector = pickVector(q?.criteria, state);
      else {
        const ids = Object.keys(q?.criteria || {});
        if (ids.length)
          answers[qid] = {
            type: "choice",
            choice: ids[0],
            probabilities: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 1 : 0])),
          };
      }
    }
    // Empty questions (single eligible action) -> harmless empty answers.
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        model: model || "kev-local",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Kev brain listening on http://localhost:${PORT}/v1/systemone`);
});
