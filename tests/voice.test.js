import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommand, parseVoiceAlternatives, voiceGrammarSrc, VOICE_COMMANDS } from "../src/voice.js";
import { Simulation } from "../src/simulation.js";

test("voice transcripts map to commands in English and Malay", () => {
  assert.equal(parseVoiceCommand("go faster"), "faster");
  assert.equal(parseVoiceCommand("tolong laju sikit"), "faster");
  assert.equal(parseVoiceCommand("slow down please"), "slower");
  assert.equal(parseVoiceCommand("perlahan"), "slower");
  assert.equal(parseVoiceCommand("turn left"), "left");
  assert.equal(parseVoiceCommand("belok kiri"), "left");
  assert.equal(parseVoiceCommand("turn right"), "right");
  assert.equal(parseVoiceCommand("ke kanan"), "right");
  assert.equal(parseVoiceCommand("do a u-turn"), "uturn");
  assert.equal(parseVoiceCommand("buat pusingan"), "uturn");
  assert.equal(parseVoiceCommand("what a nice day"), null);
  assert.equal(parseVoiceCommand(""), null);
  // Whole words only: "bright" is not "right".
  assert.equal(parseVoiceCommand("what a bright day"), null);
});

test("common mishearings still resolve to the right command", () => {
  assert.equal(parseVoiceCommand("go master"), "faster");
  assert.equal(parseVoiceCommand("tekan minyak"), "faster");
  assert.equal(parseVoiceCommand("brake"), "slower");
  assert.equal(parseVoiceCommand("turn lift"), "left");
  assert.equal(parseVoiceCommand("go to the light"), "right");
  assert.equal(parseVoiceCommand("you turn here"), "uturn");
  // A command hiding in a lower-ranked alternative still counts.
  assert.deepEqual(
    parseVoiceAlternatives(["go mustard", "go master", "go faster"]),
    { cmd: "faster", text: "go master" },
  );
  assert.equal(parseVoiceAlternatives(["lovely weather"]), null);
  assert.equal(parseVoiceAlternatives([]), null);
});

test("a spoken command biases driving until it expires", () => {
  const sim = new Simulation(7, "town");
  assert.deepEqual(sim.voiceBias(), { steer: 0, boost: 0, cmd: null });
  sim.setVoice("faster");
  assert.equal(sim.voiceBias().cmd, "faster");
  assert(sim.voiceBias().boost > 0);
  sim.setVoice("left");
  assert(sim.voiceBias().steer < 0);
  sim.time += 30;
  assert.deepEqual(sim.voiceBias(), { steer: 0, boost: 0, cmd: null });
  assert.equal(sim.setVoice("nonsense"), null);
});

test("every voice command has Jev wording", () => {
  for (const cmd of ["faster", "slower", "left", "right", "uturn"])
    assert.match(VOICE_COMMANDS[cmd].instruction, /voice command/i);
});

test("the recognizer grammar covers the whole vocabulary", () => {
  const src = voiceGrammarSrc();
  assert.match(src, /^#JSGF V1\.0/);
  for (const words of [
    ["faster", "laju"],
    ["slower", "perlahan"],
    ["left", "kiri"],
    ["right", "kanan"],
    ["uturn", "pusing"],
  ])
    for (const word of words)
      assert(src.includes(word), `grammar should include ${word}`);
});
