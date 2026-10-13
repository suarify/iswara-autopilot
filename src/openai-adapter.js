// OpenAI Decisions API adapter — https://developers.openai.com/api/docs/guides/decisions
//
// The Decisions endpoint takes the same speculative question set we build for
// Jev and spells it differently:
//
//   our question             -> their question
//   {type:"choice", criteria} -> {type:"choice", choices:[{value, description}]}
//   {type:"noul"}             -> {type:"predicate"} (returns `probability`)
//   {type:"score", criteria}  -> {type:"score", levels:[{label, description}]}
//
// Answers come back as an ARRAY keyed by the question `name` we chose, which
// fromOpenAIAnswers() folds back into the {choice, probabilities} object map
// planning.decisionSelection() reads — so the driving pipeline stays
// provider-agnostic. Pure translation, no fetch: jev-client.js owns transport.
export const OPENAI_ENDPOINT = "https://api.openai.com/v1/decisions";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
export const OPENAI_DEFAULT_MODEL = "gpt-6-luna";
export const OPENAI_INPUT_PRICE = 0.1; // $ per 1M input tokens
export const OPENAI_OUTPUT_PRICE = 0; // Decisions bills input only

const num = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Our instructions are one string; the extension's {question, focus} fits too. */
function instructionText(instructions) {
  if (typeof instructions === "string") return instructions;
  return [instructions?.question, instructions?.focus]
    .filter(Boolean)
    .join(" ");
}

/** Score criteria are objects like {what:"…"}; labels must be short and unique. */
function scoreLevels(criteria) {
  const raw = Array.isArray(criteria)
    ? criteria.map((c) => (typeof c === "string" ? c : c?.what ?? ""))
    : Object.entries(criteria || {}).map(([k, v]) =>
        typeof v === "string" ? v : (v?.what ?? k),
      );
  const seen = new Set();
  return raw.map((description, i) => {
    let label = `Level ${i + 1}`;
    while (seen.has(label)) label = `Level ${i + 1}.${seen.size}`;
    seen.add(label);
    return { label, description: String(description).slice(0, 300) };
  });
}

/**
 * The state object rendered as the single evidence string the API evaluates —
 * full world geometry, candidates and instructions included.
 */
export function stateToInputText(state) {
  return JSON.stringify(state ?? {});
}

/**
 * Our {id: question} map -> the API's `questions` array. `name` carries our id
 * so the answer array folds back by name.
 */
export function toOpenAIQuestions(questions) {
  const out = [];
  for (const [id, q] of Object.entries(questions || {})) {
    const instructions = instructionText(q.instructions);
    if (!instructions) continue;
    const criteria = q.criteria ?? {};
    if (q.type === "choice") {
      const choices = Object.entries(criteria).map(([value, description]) => {
        const what =
          typeof description === "string"
            ? description
            : (description?.what ?? null);
        return what ? { value, description: String(what).slice(0, 300) } : { value };
      });
      // The API rejects a choice question with fewer than two options; those
      // are answered locally anyway (prepareJevRequest's singleAnswer).
      if (choices.length < 2) continue;
      out.push({ type: "choice", name: id, instructions, choices });
    } else if (q.type === "score") {
      const levels = scoreLevels(criteria);
      if (levels.length < 2) continue;
      out.push({ type: "score", name: id, instructions, levels });
    } else {
      out.push({ type: "predicate", name: id, instructions });
    }
  }
  return out;
}

/**
 * Everything needed to make the call, without making it — shared by
 * jev-client.js (which sends it) and the JSON inspector (which shows it).
 */
export function buildOpenAIBody(prepared, model = OPENAI_DEFAULT_MODEL) {
  return {
    model: text(model) || OPENAI_DEFAULT_MODEL,
    input: stateToInputText(prepared?.request?.state),
    questions: toOpenAIQuestions(prepared?.request?.questions),
  };
}

/** `[{value, probability}]` -> `{value: probability}`; score entries use label. */
function probabilitiesToMap(list) {
  const out = {};
  for (const p of Array.isArray(list) ? list : []) {
    const key = p?.value ?? p?.label;
    if (key === undefined || key === null) continue;
    out[String(key)] = num(p?.probability);
  }
  return out;
}

/** Highest-probability entry of a score answer — its label is the resolved level. */
function topLabel(list) {
  let best = null;
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || p.label === undefined) continue;
    if (!best || num(p.probability) > num(best.probability)) best = p;
  }
  return best ? String(best.label) : "";
}

/**
 * The `answers` array -> our {id: {type, …}} map. Refusals are dropped from
 * the map and reported separately, so a refused question surfaces as an error
 * instead of a silently missing answer.
 *
 * Choice probabilities are the one Jev-specific extra: planning.vectorWeights
 * needs every offered option to carry a finite value in [0,1], so options the
 * API ruled out are zero-filled and the chosen one is treated as certain when
 * nothing better was reported.
 */
export function fromOpenAIAnswers(data, questions = {}) {
  const answers = {};
  const refusals = [];
  // Only questions we actually asked can be answered: a stray name would
  // otherwise look like a missing answer downstream. An empty map (no
  // caller-provided context) keeps everything.
  const known =
    questions && Object.keys(questions).length ? questions : null;
  for (const a of Array.isArray(data?.answers) ? data.answers : []) {
    const id = a?.name;
    if (!id || (known && !Object.hasOwn(known, id))) continue;
    if (a.type === "refusal") {
      refusals.push(id);
      continue;
    }
    if (a.type === "predicate") {
      const p = num(a.probability);
      answers[id] = {
        type: "noul",
        noul: p,
        answer: p >= 0.5,
        confidence: num(a.confidence, p),
      };
    } else if (a.type === "choice") {
      const choice =
        typeof a.choice === "object" && a.choice !== null
          ? String(a.choice.value ?? "")
          : String(a.choice ?? "");
      const reported = probabilitiesToMap(a.probabilities);
      const offered = questions?.[id]?.criteria
        ? Object.keys(questions[id].criteria)
        : null;
      const probabilities = {};
      for (const [key, value] of Object.entries(reported))
        if (
          Number.isFinite(value) &&
          (!offered || offered.includes(key))
        )
          probabilities[key] = clamp01(value);
      if (offered)
        for (const option of offered)
          if (!(option in probabilities))
            probabilities[option] = option === choice ? 1 : 0;
      if (choice && !(choice in probabilities)) probabilities[choice] = 1;
      answers[id] = {
        type: "choice",
        choice,
        confidence: num(a.confidence),
        probabilities,
      };
    } else if (a.type === "score") {
      answers[id] = {
        type: "score",
        score: num(a.score),
        choice: topLabel(a.probabilities),
        confidence: num(a.confidence),
        probabilities: probabilitiesToMap(a.probabilities),
      };
    }
  }
  return { answers, refusals };
}

/**
 * Decisions usage keys are undocumented, so accept every spelling we have
 * seen (input_tokens, prompt_tokens, input …) and default to zeros rather
 * than failing the decision over missing accounting.
 */
export function normalizeUsage(usage) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = usage?.[key];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  };
  return {
    input_tokens: pick("input_tokens", "prompt_tokens", "input"),
    output_tokens: pick("output_tokens", "completion_tokens", "output"),
  };
}

// ---------------------------------------------------------------------------
// Model list (GET /v1/models) — the "List models" button in the key dialog.
// ---------------------------------------------------------------------------

/** `GET /v1/models` replies `{object:"list", data:[{id, …}]}`; proxies may
 * answer a bare array of ids or of `{id}` objects. Both, plus odd plain
 * string entries, fold into a de-duplicated id list in API order. */
export function modelIdsFrom(payload) {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  const ids = [];
  const seen = new Set();
  for (const entry of list) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

/** The gpt-6-luna family is what POST /v1/decisions currently accepts. */
export function isDecisionModel(id) {
  return /luna/i.test(String(id || ""));
}

/** Case-insensitive substring filter with decision-capable models floated to
 * the top, because the list mixes every model the key can see. Equal ranks
 * keep API order — Array#sort is stable. */
export function filterModelIds(ids, query) {
  const q = text(query).toLowerCase();
  return (Array.isArray(ids) ? ids : [])
    .filter((id) => !q || String(id).toLowerCase().includes(q))
    .sort((a, b) => Number(isDecisionModel(b)) - Number(isDecisionModel(a)));
}
