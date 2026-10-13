import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_ENDPOINT,
  OPENAI_DEFAULT_MODEL,
  buildOpenAIBody,
  fromOpenAIAnswers,
  normalizeUsage,
  modelIdsFrom,
  filterModelIds,
  isDecisionModel,
} from "../src/openai-adapter.js";
import { prepareJevRequest } from "../src/jev-request.js";
import { evaluateBrain } from "../src/jev-client.js";
import { Simulation } from "../src/simulation.js";

const sample = () => new Simulation(42).decisionState();
const prepared = (state = sample()) => prepareJevRequest(state);

test("OpenAI body mirrors the Jev question set", () => {
  const req = prepared();
  const body = buildOpenAIBody(req, "");
  assert.equal(body.model, OPENAI_DEFAULT_MODEL);
  assert.equal(JSON.stringify(Object.keys(body)), '["model","input","questions"]');
  assert.equal(body.input, JSON.stringify(req.request.state));

  const names = body.questions.map((q) => q.name).sort();
  assert.deepEqual(names, Object.keys(req.request.questions).sort());
  for (const q of body.questions) {
    assert.equal(q.type, "choice");
    assert.equal(typeof q.instructions, "string");
    assert(q.instructions.length > 0);
    assert(q.choices.length >= 2, `${q.name} needs at least two choices`);
    assert.deepEqual(
      q.choices.map((c) => c.value),
      Object.keys(req.request.questions[q.name].criteria),
    );
  }
  assert(!JSON.stringify(body).includes("sk-"));
});

test("choice answers fold back with every offered option scored", () => {
  const questions = {
    motion: { type: "choice", instructions: "…", criteria: { drive: null, stop: null } },
    vector: { type: "choice", instructions: "…", criteria: { v0: null, v1: null, v2: null } },
  };
  const { answers, refusals } = fromOpenAIAnswers(
    {
      answers: [
        { type: "choice", name: "motion", choice: "drive", confidence: 0.9, probabilities: [{ value: "drive", probability: 1.4 }] },
        { type: "choice", name: "vector", choice: "v1", probabilities: [{ value: "v1", probability: -3 }, { value: "ghost", probability: 0.5 }] },
      ],
    },
    questions,
  );
  assert.deepEqual(refusals, []);
  assert.equal(answers.motion.choice, "drive");
  assert.equal(answers.motion.probabilities.drive, 1);
  assert.equal(answers.motion.probabilities.stop, 0);
  assert.equal(answers.vector.choice, "v1");
  assert.equal(answers.vector.probabilities.v0, 0);
  assert.equal(answers.vector.probabilities.v1, 0);
  assert.equal(answers.vector.probabilities.v2, 0);
  assert(!Object.hasOwn(answers.vector.probabilities, "ghost"));
  assert.equal(answers.vector.confidence, 0);
});

test("a missing choice is treated as certain, refusals are reported", () => {
  const questions = {
    route: { type: "choice", instructions: "…", criteria: { a: null, b: null } },
    vector: { type: "choice", instructions: "…", criteria: { v0: null, v1: null } },
  };
  const { answers, refusals } = fromOpenAIAnswers(
    {
      answers: [
        { type: "choice", name: "route", choice: "b", probabilities: [] },
        { type: "refusal", name: "vector" },
        { type: "choice", name: "stray", choice: "x" },
      ],
    },
    questions,
  );
  assert.equal(answers.route.probabilities.b, 1);
  assert.equal(answers.route.probabilities.a, 0);
  assert.deepEqual(refusals, ["vector"]);
  assert(!Object.hasOwn(answers, "stray"), "answers we never asked for are dropped");
});

test("usage accepts every spelling and defaults to zeros", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 1200, completion_tokens: 7 }), {
    input_tokens: 1200,
    output_tokens: 7,
  });
  assert.deepEqual(normalizeUsage({ input_tokens: 5 }), {
    input_tokens: 5,
    output_tokens: 0,
  });
  assert.deepEqual(normalizeUsage(undefined), {
    input_tokens: 0,
    output_tokens: 0,
  });
  assert.deepEqual(normalizeUsage({ input_tokens: "nope" }), {
    input_tokens: 0,
    output_tokens: 0,
  });
});

test("the model list floats decision models to the top", () => {
  const ids = modelIdsFrom({
    object: "list",
    data: [{ id: "gpt-4o" }, { id: "gpt-6-luna" }, { id: "whisper-1" }, { id: "gpt-6-luna" }],
  });
  assert.deepEqual(ids, ["gpt-4o", "gpt-6-luna", "whisper-1"]);
  assert.deepEqual(filterModelIds(ids, "GPT-6"), ["gpt-6-luna"]);
  assert.deepEqual(filterModelIds(ids, "LUNA").filter(isDecisionModel), ["gpt-6-luna"]);
  assert.deepEqual(modelIdsFrom([{ id: "a" }, "b", 3]), ["a", "b"]);
});

// Answers that echo the first offered option of every question we sent —
// enough for planning.decisionSelection to resolve a real control.
const echoAnswers = (req) =>
  Object.entries(req.request.questions).map(([name, q]) => ({
    type: "choice",
    name,
    choice: Object.keys(q.criteria)[0],
    confidence: 0.8,
    probabilities: Object.keys(q.criteria).map((value, i) => ({
      value,
      probability: i === 0 ? 1 : 0,
    })),
  }));

test("evaluateBrain drives the Decisions API end to end", async () => {
  const state = sample();
  const req = prepared(state);
  const original = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, options) => {
    seen = { url, options, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({
        model: OPENAI_DEFAULT_MODEL,
        answers: echoAnswers(req),
        usage: { prompt_tokens: 1200, completion_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await evaluateBrain(state, {
      provider: "openai",
      apiKey: "sk-test",
      model: OPENAI_DEFAULT_MODEL,
    });
    assert.equal(seen.url, OPENAI_ENDPOINT);
    assert.equal(seen.options.headers.Authorization, "Bearer sk-test");
    assert.deepEqual(Object.keys(seen.body).sort(), ["input", "model", "questions"]);
    assert.equal(seen.body.model, OPENAI_DEFAULT_MODEL);
    assert.equal(typeof seen.body.input, "string");
    assert.equal(seen.body.questions.length, Object.keys(req.request.questions).length);
    assert(!JSON.stringify(seen.body).includes("sk-test"));

    assert.equal(result.decision_source, "openai");
    assert.equal(result.usage.input_tokens, 1200);
    assert.equal(result.pricing.input_per_million, 0.1);
    assert.equal(result.pricing.output_per_million, 0);
    assert.equal(result.cost_usd, (1200 * 0.1) / 1e6);
    assert.equal(result.brain_model, OPENAI_DEFAULT_MODEL);
    assert.equal(result.request_bytes > 0, true);
    assert(result.selection?.choice);
    assert.equal(Number.isFinite(result.controls.steering), true);
    assert.equal(Number.isFinite(result.controls.velocity), true);
    assert.equal(result.latency_ms >= 0, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("OpenAI without a key is a 503, not a fetch", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("", { status: 500 });
  };
  try {
    await assert.rejects(
      () => evaluateBrain(sample(), { provider: "openai" }),
      /No OpenAI API key/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a rejected OpenAI key names the provider", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 401 });
  try {
    await assert.rejects(
      () => evaluateBrain(sample(), { provider: "openai", apiKey: "sk-bad" }),
      /OpenAI rejected the API key/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
