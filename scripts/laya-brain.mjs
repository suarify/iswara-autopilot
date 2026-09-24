// Minimal local Laya brain — keyless heuristic stub that drives.
// Listens on http://localhost:8081/v1/drive (and /v1/systemone).
// Same Jev protocol as kev-brain; Laya prefers the fastest non-zero
// candidate like Kev but is kept as a separate process/model name.
import { createServer } from "node:http";

const PORT = Number(process.env.LAYA_PORT || 8081);

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
  let choice = ids[0];
  try {
    const c = state?.candidates;
    const cols = c?.columns || [];
    const rows = c?.rows || {};
    const speedIdx = cols.indexOf("speed");
    if (speedIdx >= 0 && rows[choice] !== undefined) {
      let best = -Infinity;
      for (const id of ids) {
        const row = rows[id];
        const s = Array.isArray(row) ? row[speedIdx] : null;
        if (typeof s === "number" && s > best) {
          best = s;
          choice = id;
        }
      }
    }
  } catch {}
  return {
    type: "choice",
    choice,
    probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
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
    return res.end(JSON.stringify({ error: "Not found. POST /v1/drive" }));
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
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        model: model || "laya-v1",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Laya brain (keyless) listening on http://localhost:${PORT}/v1/drive`);
});
