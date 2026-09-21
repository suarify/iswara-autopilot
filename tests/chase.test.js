import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import { prepareJevRequest } from "../src/jev-request.js";
import { dist, move } from "../src/math.js";

test("chase mode is opt-in and spawns the Myvi/Wira/Tesla pack behind", () => {
  const plain = new Simulation(7, "town");
  assert(!plain.traffic.some((v) => v.chaser));
  const sim = new Simulation(7, "town", { chase: true });
  const pack = sim.traffic.filter((v) => v.chaser);
  assert.deepEqual(
    pack.map((v) => v.model).sort(),
    ["myvi", "tesla", "wira"],
  );
  for (const v of pack) {
    assert.equal(v.type, "car");
    assert(v.route === null);
  }
  const chaser = sim.activeChaser();
  assert.equal(chaser.model, "myvi");
  const gap = dist(chaser, sim.player);
  assert(gap > 15 && gap < 30, `lead hunter starts ~20m back, got ${gap}`);
});

test("traffic cars draw from the GLB fleet, bikes stay procedural", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const fleet = new Set(["tesla", "wira", "myvi", "tank"]);
  for (const v of sim.traffic) {
    if (v.chaser) continue;
    if (v.type === "motorcycle") assert.equal(v.model, null);
    else assert(fleet.has(v.model), `unexpected model ${v.model}`);
  }
  const used = new Set(
    sim.traffic.filter((v) => v.model).map((v) => v.model),
  );
  assert(used.size > 1, "fleet should vary across traffic");
});

test("the chaser closes the gap while the player crawls", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const chaser = sim.activeChaser();
  sim.player.speed = 2;
  sim.player.target = 2;
  const start = sim.pursuerGap();
  for (let i = 0; i < 200; i++) sim.step(0.05);
  assert(
    sim.pursuerGap() < start,
    `chaser should close in: ${start} -> ${sim.pursuerGap()}`,
  );
});

test("a closing pursuer raises the player's planning ceiling to flee", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const calm = new Simulation(7, "town");
  // Same pose/speed so only the pursuer changes the envelope.
  calm.player.speed = sim.player.speed = 8;
  const flee = sim.speedEnvelope(sim.player).planningMax;
  const base = calm.speedEnvelope(calm.player).planningMax;
  assert(
    flee > base,
    `flee ceiling ${flee} should exceed base ${base}`,
  );
  assert(flee <= sim.world.theme.limit + 6.01);
});

test("contact with a hunter tags but never crashes or disengages", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const chaser = sim.activeChaser();
  chaser.x = sim.player.x + 1;
  chaser.z = sim.player.z;
  sim.autopilot = true;
  sim.step(0.05);
  assert(sim.caught);
  assert.equal(sim.autopilot, true);
  assert.equal(sim.crash, null);
});

test("three seconds after a tag the pack hunts again", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const chaser = sim.activeChaser();
  const who = chaser.label ?? chaser.model;
  chaser.x = sim.player.x + 1;
  chaser.z = sim.player.z;
  sim.player.speed = 8;
  sim.step(0.05);
  assert(sim.caught);
  assert.equal(sim.chaseStats.caught[who], 1);
  for (let i = 0; i < 61; i++) sim.step(0.05);
  assert.equal(sim.caught, null);
  // Pack drops back into formation behind the player, counter kept.
  const gap = dist(sim.activeChaser(), sim.player);
  assert(gap > 10 && gap < 45, `pack should reset behind, gap ${gap}`);
  assert.equal(sim.chaseStats.caught[who], 1);
  // …and it tries again: keep crawling and it re-tags.
  for (let i = 0; i < 400 && !sim.caught; i++) sim.step(0.05);
  assert(sim.caught, "pack should hunt again after release");
  assert.equal(sim.chaseStats.caught[who], 2);
});

test("the player cannot drive through a hunter", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const chaser = sim.activeChaser();
  // Park a hunter ahead of the player and ram it head-on at capped speed.
  const ahead = move(sim.player, sim.player.heading, 25);
  chaser.x = ahead.x;
  chaser.z = ahead.z;
  chaser.heading = sim.player.heading;
  chaser.speed = 0;
  sim.player.speed = 0;
  sim.autopilot = false;
  sim.pedals.throttle = 1;
  for (let i = 0; i < 200 && !sim.caught && !sim.crash; i++) {
    sim.step(0.05);
    sim.player.speed = Math.min(sim.player.speed, 10);
  }
  assert(sim.caught, "ramming a hunter should end the drive as caught");
  assert.equal(sim.crash, null);
  assert(
    dist(sim.player, chaser) < 6,
    "player should be stopped at the hunter, not through it",
  );
});

test("a distant pursuer held off for 5 seconds counts as escaped", () => {
  const sim = new Simulation(7, "town", { chase: true });
  sim.player.x += 500;
  sim.player.z += 500;
  for (let i = 0; i < 130; i++) sim.step(0.05);
  assert(sim.escaped);
});

test("the chase counter tracks rounds, catches and escapes", () => {
  const sim = new Simulation(7, "town", { chase: true });
  assert.equal(sim.chaseStats.rounds, 1);
  const chaser = sim.activeChaser();
  chaser.x = sim.player.x + 1;
  chaser.z = sim.player.z;
  sim.step(0.05);
  assert(sim.caught);
  const who = sim.caught.by;
  assert.equal(sim.chaseStats.caught[who], 1);
  // A fresh drive starts a new round and keeps the totals.
  sim.reset(7, "town");
  assert.equal(sim.chaseStats.rounds, 2);
  assert.equal(sim.chaseStats.caught[who], 1);
  sim.player.x += 500;
  sim.player.z += 500;
  for (let i = 0; i < 130; i++) sim.step(0.05);
  assert(sim.escaped);
  assert.equal(sim.chaseStats.escaped, 1);
});

test("decision state exposes the pursuer and Jev gets flee wording", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const full = sim.decisionState();
  assert(full.traffic.pursuer);
  assert.match(full.traffic.pursuer.id, /^chaser-/);
  const { request: req } = prepareJevRequest(full);
  assert(req.state.pursuer, "compressed request should carry the pursuer");
  assert.match(req.state.driving_style, /pursuer/i);
});
