import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBrain, validState, DEFAULT_ENDPOINT } from "../src/jev-client.js";
import { Simulation } from "../src/simulation.js";

test("direct call hits the custom endpoint with model and key", async () => {
  const sample = new Simulation(42).decisionState();
  assert(validState(sample));
  const original = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, options) => {
    seen = { url, options, body: JSON.parse(options.body) };
    return new Response("", { status: 401 });
  };
  try {
    await assert.rejects(
      () =>
        evaluateBrain(sample, {
          apiKey: "sk-laya-test",
          endpoint: "http://localhost:8000/v1/systemone",
          model: "laya-v1",
        }),
      /rejected the API key/,
    );
    assert.equal(seen.url, "http://localhost:8000/v1/systemone");
    assert.equal(seen.options.headers.Authorization, "Bearer sk-laya-test");
    assert.equal(seen.body.model, "laya-v1");
    assert(!JSON.stringify(seen.body).includes("sk-laya-test"));
  } finally {
    globalThis.fetch = original;
  }
});

test("keyless local brains send no auth header", async () => {
  const sample = new Simulation(42).decisionState();
  const original = globalThis.fetch;
  let headers = null;
  globalThis.fetch = async (url, options) => {
    headers = options.headers;
    return new Response("", { status: 401 });
  };
  try {
    await assert.rejects(() =>
      evaluateBrain(sample, { endpoint: "http://localhost:8009/v1/systemone" }),
    );
    assert.equal(headers.Authorization, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("missing key on the shared endpoint is a 503, not a fetch", async () => {
  const sample = new Simulation(42).decisionState();
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("", { status: 500 });
  };
  try {
    await assert.rejects(
      () => evaluateBrain(sample, { endpoint: DEFAULT_ENDPOINT }),
      /No API key/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
