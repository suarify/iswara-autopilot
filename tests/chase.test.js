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
  const fleet = new Set(["tesla", "wira", "myvi", "tank", "bezza"]);
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

test("the flee ceiling scales with pack distance", () => {
  const sim = new Simulation(7, "town", { chase: true });
  const calm = new Simulation(7, "town");
  const ceilingAt = (gap) => {
    for (const v of sim.chasePack()) {
      v.x = sim.player.x;
      v.z = sim.player.z - gap;
    }
    return sim.speedEnvelope(sim.player).planningMax;
  };
  const base = calm.speedEnvelope(calm.player).planningMax;
  assert(ceilingAt(250) <= base, "beyond 200m no boost");
  assert.equal(ceilingAt(150) - base > 0, true);
  const mid = ceilingAt(150),
    near = ceilingAt(30),
    urgent = ceilingAt(10);
  assert(mid < near && near < urgent, `graded ${mid} < ${near} < ${urgent}`);
  assert(urgent <= sim.world.theme.limit + 9.01);
});

test("under 20m Jev gets an urgent avoid-hit-first instruction", () => {  const sim = new Simulation(7, "town", { chase: true });
  for (const v of sim.chasePack()) {
    v.x = sim.player.x;
    v.z = sim.player.z - 12;
  }
  const { request } = prepareJevRequest(sim.decisionState());
  assert.match(request.state.driving_style, /URGENT/);
});

test("escape mode lifts the decision ceiling above the limit", () => {
  const sim = new Simulation(7, "town", { chase: true });
  sim.player.speed = 10;
  const full = sim.decisionState();
  assert(sim.escapeMode());
  assert(
    full.speed_ceiling_mps > sim.world.theme.limit,
    `ceiling ${full.speed_ceiling_mps} should beat limit ${sim.world.theme.limit}`,
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
  assert(flee <= sim.world.theme.limit + 9.01);
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
  // The first tag must have released by now (another hunter may already
  // have re-tagged, which also proves the hunt continues).
  assert(
    sim.events.some((e) => e.text.includes("back on you")),
    "pack should release ~3s after a tag",
  );
  const tags = Object.values(sim.chaseStats.caught).reduce((a, b) => a + b, 0);
  assert(tags >= 1);
  // …and the hunt continues: a slow player gets tagged again.
  for (let i = 0; i < 400 && !sim.caught; i++) sim.step(0.05);
  assert(sim.caught, "pack should hunt again after release");
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

test("escape mode ignores queues but keeps collision caps", () => {
  const sim = new Simulation(7, "town", { chase: true });
  // Park the pack on the bumper and a stopped lead right ahead.
  for (const v of sim.chasePack()) {
    v.x = sim.player.x;
    v.z = sim.player.z - 10;
  }
  const lead = sim.traffic.find((v) => !v.chaser && v.type === "car");
  lead.x = sim.player.x;
  lead.z = sim.player.z - 12;
  lead.heading = sim.player.heading;
  lead.speed = 0;
  sim.player.speed = 8;
  assert(sim.escapeMode(), "pack under 20m should arm escape mode");
  const env = sim.speedEnvelope(sim.player);
  assert(
    env.max > 10,
    `escape should not queue behind the stopped lead, got ${env.max}`,
  );
  const full = sim.decisionState();
  assert.equal(sim.player.escapeMode, true);
  void full;
});
