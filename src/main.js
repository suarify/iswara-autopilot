import "./style.css";
import {
  createIcons,
  Braces,
  RotateCw,
  Video,
  Pause,
  Play,
  Map,
  Maximize,
  Minimize,
  Sparkles,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  ArrowUpRight,
  X,
  Copy,
  Download,
  RotateCcw,
  CircleHelp,
  Plus,
  Minus,
  Grip,
  Github,
  LogOut,
  Key,
  Mic,
  Music,
} from "lucide";
import { Simulation } from "./simulation.js";
import { BackgroundPlanner } from "./background-planner.js";
import { DriveScene } from "./scene.js";
import { MinimapControls } from "./minimap-controls.js";
import { Tooltips } from "./tooltips.js";
import { TouchControls } from "./touch-controls.js";
import {
  showLoading,
  hideLoading,
  loadingFailed,
  nextPaint,
} from "./loading-screen.js";
import { prepareJevRequest, decisionInterval } from "./jev-request.js";
import { THEMES } from "./world.js";
import { candidateName, decisionControls } from "./planning.js";
import { clamp, nearestOnPath } from "./math.js";
import { parseVoiceAlternatives, voiceGrammarSrc, VOICE_COMMANDS } from "./voice.js";
import * as THREE from "three";
import { HERO_MODELS, loadHeroCar } from "./model-assets.js";
const icons = {
  Braces,
  RotateCw,
  Video,
  Pause,
  Play,
  Map,
  Maximize,
  Minimize,
  Sparkles,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  ArrowUpRight,
  X,
  Copy,
  Download,
  RotateCcw,
  CircleHelp,
  Plus,
  Minus,
  Grip,
  Github,
  LogOut,
  Key,
  Mic,
  Music,
};
const icon = (name) => `<i data-lucide="${name}"></i>`,
  $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search),
  aliases = { suburb: "town", country: "highway" },
  requested = params.get("world") || "city",
  type = aliases[requested] || requested;
const sim = new Simulation(
  Number(params.get("seed")) || Math.floor(Math.random() * 999999),
  THEMES[type] ? type : "city",
  // A Myvi starts behind the player and hunts it; Jev is told to escape.
  // Disable with ?chase=0.
  { chase: params.get("chase") !== "0" },
);
let playCredits = null,
  loading = true,
  lastMapDraw = 0;
showLoading("Loading car and scenery…");
let configured = false,
  authRequired = true,
  busy = false,
  generation = 0,
  lastDecision = null,
  lastInput = null,
  lastContext = null,
  lastApplied = 0,
  nextDecision = 0,
  nextContextCheck = 0,
  errors = 0,
  inspectorTab = "request",
  inspectFrozen = false,
  uiTime = 0,
  lastNow = performance.now(),
  toastTimer,
  crashHandled = false,
  chaseToast = "",
  lastExpireAt = 0;
const keys = new Set(),
  tally = {
    cost: 0,
    calls: 0,
    constrained_steps: 0,
    request_bytes: 0,
    input: 0,
    output: 0,
    latencies: [],
    intervals: [],
  };
$("app").innerHTML = `
<main class="drive-area" aria-label="3D driving simulator"><canvas id="world-canvas" aria-label="Interactive three-dimensional driving world"></canvas><div id="vector-labels" aria-label="Jev motion vector probabilities"></div></main>
<header class="topbar glass"><a href="/" class="brand" aria-label="Kancil Autopilot"><img class="brand-mark" src="/logokancil.jpg" alt=""/><b>Kancil Autopilot</b></a><div class="world-picker"><select id="world-select" aria-label="World environment"><option value="city">Skyline City</option><option value="town">Small town</option><option value="highway">Interstate 08</option></select><button id="new-world" title="Refresh world" aria-label="Refresh world">${icon("rotate-cw")}</button><a id="github-link" href="https://github.com/standardagents/jevpilot" target="_blank" rel="noopener noreferrer" aria-label="View JevPilot on GitHub (opens in a new tab)" title="View on GitHub">${icon("github")}</a></div></header>
<div class="navigation-hud"><div class="navigation-card glass"><span id="turn-icon">${icon("arrow-up")}</span><div><strong id="next-maneuver">Continue straight</strong><span id="turn-distance"></span></div><span class="nav-divider"></span><span id="remaining"></span><button id="map-toggle" aria-label="Toggle route map" aria-pressed="true" title="Hide route map">${icon("map")}</button></div>
<div id="minimap" class="minimap glass"><div class="minimap-toolbar" role="toolbar" aria-label="Minimap controls"><button id="map-drag" aria-label="Move minimap" title="Move minimap · drag or use arrow keys">${icon("grip")}</button><div><button id="map-zoom-out" aria-label="Zoom out" title="Zoom out">${icon("minus")}</button><button id="map-zoom-in" aria-label="Zoom in" title="Zoom in">${icon("plus")}</button><button id="map-reset" aria-label="Reset minimap" title="Reset map position, zoom and following">${icon("rotate-ccw")}</button></div></div><canvas id="map-canvas" width="380" height="310" aria-label="Route map. Drag to pan, scroll to zoom, double-click to follow the car."></canvas></div></div>
<div id="paused-overlay" hidden><div class="glass"><span>${icon("pause")} Paused</span><button id="resume" class="primary">Resume driving</button></div></div>
<div id="chase-banner" hidden></div>
<div id="arrival" class="arrival glass" hidden><span class="arrival-mark">${icon("flag")}</span><span class="eyebrow">DESTINATION REACHED</span><h1>You made it.</h1><p id="arrival-summary"></p><button id="next-trip" class="primary">Next drive ${icon("arrow-up-right")}</button><button id="keep-driving" class="subtle">Keep exploring</button></div>
<div id="intro-overlay" hidden><div class="intro-card glass"><img class="intro-logo" src="/logokancil.jpg" alt="Teal Kancil" /><span class="eyebrow">KANCIL AUTOPILOT</span><h1>Outrun the Myvi gang.</h1><p>Reach the destination flag before the Myvi, Wira and Tesla hunters tag you. Tagged? You get 3 seconds — then they're back on you. Don't bang anything: saman is expensive.</p><canvas id="car-preview" width="520" height="300" aria-label="Preview of your car. Drag to spin it around."></canvas><div class="car-picker"><button id="car-prev" aria-label="Previous car">‹</button><strong id="car-name">Myvi Stripy</strong><button id="car-next" aria-label="Next car">›</button></div><div id="car-dots" class="car-dots"></div><div class="intro-actions"><button id="voice-intro" class="subtle" aria-label="Voice command">${icon("mic")} Voice</button><button id="start-drive" class="primary">Start drive</button></div><p class="intro-keys">WASD drive · J autopilot · drag the car to spin it</p></div></div>
<div class="bottom-hud"><div class="driver-dock glass"><div class="speed-cluster"><div title="Current speed"><strong id="speed">0</strong><span>km/h</span></div><span class="speed-limit" title="Speed limit"><small>LIMIT</small><b id="speed-limit">50</b></span></div><span class="dock-divider"></span><div class="pilot-actions"><button id="autopilot" class="pilot-button" role="switch" aria-checked="false" aria-label="Jev autopilot" title="Engage Jev · J">${icon("sparkles")}<span id="pilot-label">Engage Jev</span><kbd>J</kbd></button><button id="candidates-toggle" class="candidate-button" aria-label="Show steering candidates" aria-pressed="false" title="Show steering candidates"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20V3m-3 3 3-3 3 3M12 20C12 14 7 12 3 8m0 3V8h3M12 20c0-6 5-8 9-12m-3 0h3v3"/><circle cx="12" cy="21" r="1" fill="currentColor" stroke="none"/></svg></button></div><div id="decision-status"><span id="pilot-state">Free play</span><span id="context-message">WASD to drive · Space to brake</span><span id="jev-ms" class="jev-ms" title="Last Jev decision round-trip"></span><span class="cost-total" title="Estimated cost from Jev-reported token usage and configured pricing."><span id="cost-label">Session</span> <strong id="cost">$0.000000</strong></span></div><span class="dock-divider"></span><div class="dock-tools" role="group" aria-label="View and driving controls"><button id="camera" title="Change camera · C" aria-label="Change camera">${icon("video")}<span id="camera-name">Chase</span></button><button id="scene-json" aria-label="Inspect live JSON" title="Inspect live JSON">${icon("braces")}</button><button id="fullscreen" aria-label="Enter fullscreen" title="Fullscreen">${icon("maximize")}</button><span class="divider"></span><button id="music" aria-label="Background music" title="Kompang Cruise on/off">${icon("music")}</button><button id="voice" aria-label="Voice command" title="Voice: faster, slower, left, right, U-turn">${icon("mic")}</button><button id="jev-key" aria-label="Jev API key" title="Add your Jev key">${icon("key")}</button><button id="pause" aria-label="Pause simulation" title="Pause · P">${icon("pause")}</button><button id="sign-out" hidden aria-label="Sign out" title="Sign out">${icon("log-out")}</button></div></div></div>
<dialog id="crash-dialog" aria-labelledby="crash-title" aria-describedby="crash-description"><span class="crash-symbol">${icon("x")}</span><span class="eyebrow">DRIVE ENDED</span><h1 id="crash-title">Game over.</h1><p id="crash-description"></p><div class="crash-stats"><div><strong id="crash-speed"></strong><span>km/h at impact</span></div><div><strong id="crash-distance"></strong><span>meters driven</span></div></div><button id="retry-drive" class="primary">${icon("rotate-ccw")} Restart drive</button><button id="crash-new-world" class="secondary">Try a new world ${icon("arrow-up-right")}</button></dialog>
<dialog id="credit-dialog" aria-labelledby="credit-title"><span class="eyebrow">THANKS FOR TAKING A DRIVE</span><h2 id="credit-title">That's your free lap.</h2><p>Your $0.25 of Jev play credit has been used. You can keep exploring with manual controls.</p><button id="credit-close" class="primary">Keep driving manually</button><a href="https://standardagents.ai/" target="_blank" rel="noopener noreferrer">Explore Standard Agents ↗</a></dialog>
<dialog id="key-dialog" aria-labelledby="key-title"><span class="eyebrow">JEV AUTOPILOT KEY</span><h2 id="key-title">Use your own Jev key.</h2><p>Paste a <a href="https://typesafe.ai/" target="_blank" rel="noopener noreferrer">TypeSafe AI</a> key to engage autopilot. It stays in this browser and is only sent to this server with drive requests — never displayed or logged.</p><input id="jev-key-input" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your TypeSafe AI key" aria-label="TypeSafe AI key" /><p id="jev-key-status" class="key-status" aria-live="polite"></p><div class="dialog-actions"><button id="key-save" class="primary">Save key</button><button id="key-test" class="secondary">Test</button><button id="key-clear" class="subtle">Remove</button><button id="key-close" class="subtle">Close</button></div></dialog>
<div id="toast" role="status" hidden></div>
<dialog id="json-dialog"><div class="json-header"><div>${icon("braces")}<strong>Under the hood</strong><span id="json-live">LIVE · 4 Hz</span></div><button id="close-json" aria-label="Close JSON inspector">${icon("x")}</button></div><div class="json-toolbar"><div class="json-tabs"><button data-tab="request" class="active">Jev input</button><button data-tab="sensor">Perception</button><button data-tab="world">Full world</button><button data-tab="decision">Response</button><button data-tab="voice">Voice</button></div><div class="json-actions"><button id="freeze-json">Freeze</button><button id="copy-json" aria-label="Copy displayed JSON">${icon("copy")} <span id="copy-json-label" aria-live="polite">Copy</span></button><button id="download-json">${icon("download")} Download</button></div></div><p id="json-description">Exact Jev API payload, including instructions and offered choices. Full geometry and control details stay local.</p><pre id="json-content"></pre></dialog>
<dialog id="help-dialog"><button id="close-help" class="dialog-close" aria-label="Close help">${icon("x")}</button><span class="eyebrow">YOUR NEXT DRIVE</span><h2>Take the wheel.</h2><p class="touch-help">Use the thumbstick to steer. Push up to accelerate, pull down to brake and reverse. Release to coast; hold Brake to stop.</p><div class="help-keys"><span><kbd>W / ↑</kbd> Hold accelerator</span><span><kbd>S / ↓</kbd> Brake / reverse</span><span><kbd>A / D</kbd> Steer</span><span><kbd>SPACE</kbd> Brake</span><span><kbd>J</kbd> Jev autopilot</span><span><kbd>C</kbd> Camera</span><span><kbd>P</kbd> Pause</span><span><kbd>?</kbd> Keyboard help</span></div><p>Drag the scene to orbit in Chase or Bird’s eye; drag to look around in Driver view. Scroll to zoom outside; double-click to recenter. Tap A/D for small corrections; hold for a sharper turn and release to recenter. Hold W to accelerate; release to coast with drag. S brakes, then reverses once stopped. Space applies the brake. Autopilot sets target speed directly.</p><p>The bright blue line is Jev's selected three-second plan. Use Candidates to see the sampled paths: forward in blue/cyan, reverse in purple, lane departures in amber, and predicted collisions in orange. Choice probabilities are available in the JSON inspector. The safety brake can reduce speed for a missed hazard; interventions are shown beside the autopilot button.</p><p class="asset-credits">Vehicle: <a href="https://sketchfab.com/3d-models/tesla-model-y-2021-c0a86cac582d4b33aba0fb1b1912d970" target="_blank" rel="noreferrer">Tesla Model Y 2021</a> by 763468712, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Geometry adapted by Tina 3D Tesla; optimized, re-materialed, and wheel-rigged for JevPilot. Tree, shrub, streetlight, surface textures and sky: <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a>, CC0.</p><p>Driving keys take back control. Use the JSON button for live inputs, full world state, probabilities, and session telemetry.</p></dialog>`;
$("app").insertAdjacentHTML(
  "beforeend",
  `
<div id="touch-controls" class="touch-controls" role="group" aria-label="Touch driving controls" hidden>
  <div class="touch-steering">
    <div class="touch-stick" role="group" aria-label="Driving joystick: drag up to accelerate, down to brake or reverse, left or right to steer">
      <span class="stick-up" aria-hidden="true">↑</span><span class="stick-down" aria-hidden="true">↓</span>
      <span class="stick-left" aria-hidden="true">‹</span><span class="stick-right" aria-hidden="true">›</span>
      <span class="touch-knob" aria-hidden="true"></span>
    </div>
    <span class="touch-hint">Drag to drive</span>
  </div>
  <button class="touch-brake" aria-label="Hold to brake"><span aria-hidden="true">Ⅱ</span>Brake</button>
</div>`,
);
createIcons({ icons });
const scene = new DriveScene($("world-canvas"), sim, $("vector-labels")),
  map = $("map-canvas").getContext("2d");
const minimap = new MinimapControls($("minimap"), sim, drawMap);
const tooltips = new Tooltips();
const touch = new TouchControls(
  $("touch-controls"),
  () =>
    !loading &&
    !sim.autopilot &&
    !sim.paused &&
    !sim.crash &&
    !document.hidden &&
    !document.querySelector("dialog[open]") &&
    (sim.freeExplore || !sim.complete),
);
const dockObserver = new ResizeObserver(([entry]) => {
  // Anchor both thumbs above the actual dock, including wrapped mobile layouts.
  const height =
    entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
  document.documentElement.style.setProperty("--dock-height", `${height}px`);
});
dockObserver.observe(document.querySelector(".driver-dock"));
for (const element of document.querySelectorAll(
  ".bottom-hud button, .bottom-hud [title], .minimap button, #map-toggle, #github-link",
))
  tooltips.set(element, element.title || element.getAttribute("aria-label"));
const planner = new BackgroundPlanner();
sim.backgroundPlanning = true;
let planningJob = null,
  rerouting = false,
  previewError = false;
async function refreshPlan() {
  if (planningJob) return planningJob;
  const token = generation,
    version = sim.routeVersion;
  const job = planner
    .run("plan", sim)
    .then((result) => {
      if (token !== generation || version !== sim.routeVersion || sim.crash)
        return null;
      sim.lastPlan = result.plan;
      sim.lastDecisionState = result.state;
      sim.routeChoices = result.routeChoices;
      sim.routeChoicesOrigin = result.routeChoicesOrigin;
      sim.nextRouteChoices = result.nextRouteChoices;
      return result;
    })
    .finally(() => {
      if (planningJob === job) planningJob = null;
    });
  planningJob = job;
  return job;
}
function requestPreview() {
  if (sim.autopilot || sim.crash) return;
  refreshPlan()
    .then((result) => {
      if (result && !sim.autopilot) scene.vectors.setCandidates(result.plan);
    })
    .catch((error) => {
      if (!previewError) {
        previewError = true;
        toast(error.message);
      }
    });
}
sim.requestReroute = async () => {
  if (rerouting || !sim.routeChoiceNeeded()) return;
  rerouting = true;
  const token = generation,
    version = sim.routeVersion;
  try {
    const next = await planner.run("reroute", sim);
    if (
      !next ||
      token !== generation ||
      version !== sim.routeVersion ||
      sim.crash ||
      !sim.routeChoiceNeeded()
    )
      return;
    if (next.route.ids.join(",") === sim.player.route.ids.join(",")) return;
    sim.installRoute({
      ...next,
      progress: nearestOnPath(sim.player, next.route.points).s,
    });
  } catch (error) {
    toast(error.message);
  } finally {
    rerouting = false;
  }
};
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    planner.dispose();
    minimap.dispose();
    tooltips.dispose();
    touch.dispose();
    dockObserver.disconnect();
    scene.dispose();
  });

function toast(text, type = "info") {
  $("toast").textContent = text;
  $("toast").classList.toggle("error", type === "error");
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4200);
}
// Personal Jev key stored only in this browser (localStorage). It is sent
// to our own server as the x-jev-key header so local dev needs no .env
// edit; it is never written into JSON views, costs, or logs.
const JEV_KEY_STORAGE = "jevpilot.jev_api_key";
const getJevKey = () => {
  try {
    return (localStorage.getItem(JEV_KEY_STORAGE) || "").trim() || null;
  } catch {
    return null;
  }
};
const hasJevKey = () => !!getJevKey();
function refreshKeyButton() {
  const key = getJevKey(),
    button = $("jev-key");
  if (!button) return;
  button.hidden = authRequired;
  tooltips.set(
    button,
    key ? `Jev key ····${key.slice(-4)} · tap to change` : "Add your Jev key",
  );
  button.classList.toggle("key-missing", !key);
}
function openKeyDialog() {
  const key = getJevKey();
  $("jev-key-input").value = "";
  $("jev-key-input").placeholder = key
    ? `Saved ····${key.slice(-4)} — paste a new key to replace`
    : "Paste your TypeSafe AI key";
  $("jev-key-status").textContent = key
    ? `Key saved in this browser (····${key.slice(-4)}).`
    : "No key saved yet.";
  $("key-clear").hidden = !key;
  $("key-dialog").showModal();
  setTimeout(() => $("jev-key-input").focus(), 50);
}
function refreshWorld() {
  const w = sim.world;
  $("world-select").value = w.type;
  $("speed-limit").textContent = Math.round(w.theme.limit * 3.6);
  $("arrival").hidden = true;
}
function syncPilot() {
  const on = sim.autopilot;
  $("autopilot").setAttribute("aria-checked", String(on));
  $("pilot-label").textContent = on ? "Jev engaged" : "Engage Jev";
  tooltips.set($("autopilot"), `${on ? "Disengage" : "Engage"} Jev · J`);
  $("autopilot").disabled = !!sim.crash;
  document.body.classList.toggle("piloting", on);
  touch.sync();
}

function setPilot(on) {
  if (loading) return;
  touch.reset();
  if (on && playCredits?.exhausted) {
    $("credit-dialog").showModal();
    return;
  }
  if (on && !configured && !hasJevKey()) {
    toast("Add your Jev key to engage autopilot.", "error");
    openKeyDialog();
    return;
  }
  if (sim.crash || (on && sim.complete)) return;
  sim.autopilot = on;
  if (on) sim.freeExplore = false;
  generation++;
  lastApplied = 0;
  nextDecision = 0;
  errors = 0;
  sim.player.target = 0;
  sim.player.steering = 0;
  sim.player.steeringProgress = 0;
  sim.player.maneuver = null;
  scene.vectors.clear();
  syncPilot();
}
async function resetWorld(seed = sim.world.seed, type = sim.world.type) {
  if (loading) return;
  loading = true;
  touch.reset();
  showLoading("Building your next drive…");
  generation++;
  crashHandled = false;
  chaseToast = "";
  $("crash-dialog").close();
  document.body.classList.remove("crashed");
  keys.clear();
  await nextPaint();
  try {
    sim.reset(seed, type, { chase: sim.chaseMode });
    minimap.resetView();
    planner.reset();
    previewError = false;
    lastApplied = 0;
    lastDecision = null;
    lastInput = null;
    lastContext = null;
    scene.build();
    scene.vectors.showCandidates = showCandidates;
    refreshWorld();
    syncPilot();
    $("paused-overlay").hidden = true;
    $("pause").innerHTML = icon("pause");
    $("pause").setAttribute("aria-label", "Pause simulation");
    tooltips.set($("pause"), "Pause simulation · P");
    createIcons({ icons });
    await finishLoading();
  } catch (error) {
    loadingFailed(error);
  }
}
async function finishLoading() {
  showLoading("Loading car and scenery…");
  await scene.ready;
  showLoading("Preparing the road…");
  await nextPaint();
  await scene.prepare();
  await document.fonts.ready;
  await nextPaint();
  lastNow = performance.now();
  loading = false;
  hideLoading();
  touch.sync();
  updateUI();
  drawMap();
  // Try music on load; browsers that block autoplay get it on first tap.
  applyMusic();
  const unlock = () => {
    applyMusic();
    removeEventListener("pointerdown", unlock);
    removeEventListener("keydown", unlock);
  };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);
  showIntro();
}
function changeCamera() {
  const modes = ["chase", "hood", "map"];
  scene.mode = modes[(modes.indexOf(scene.mode) + 1) % 3];
  scene.snap = true;
  $("camera-name").textContent = {
    chase: "Chase",
    hood: "Driver",
    map: "Bird’s eye",
  }[scene.mode];
  tooltips.set(
    $("camera"),
    `Change camera · ${$("camera-name").textContent} · C`,
  );
}
function togglePause() {
  if (sim.crash || loading || !$("intro-overlay").hidden) return;
  touch.reset();
  keys.clear();
  sim.paused = !sim.paused;
  touch.sync();
  generation++;
  lastApplied = 0;
  nextDecision = 0;
  $("paused-overlay").hidden = !sim.paused;
  $("pause").innerHTML = icon(sim.paused ? "play" : "pause");
  tooltips.set($("pause"), `${sim.paused ? "Resume" : "Pause"} simulation · P`);
  $("pause").setAttribute(
    "aria-label",
    sim.paused ? "Resume simulation" : "Pause simulation",
  );
  createIcons({ icons });
}
$("autopilot").onclick = () => setPilot(!sim.autopilot);
let showCandidates = false,
  candidatePreviewAt = 0;
$("candidates-toggle").onclick = () => {
  showCandidates = !showCandidates;
  scene.vectors.showCandidates = showCandidates;
  $("candidates-toggle").setAttribute("aria-pressed", String(showCandidates));
  const label = `${showCandidates ? "Hide" : "Show"} steering candidates`;
  $("candidates-toggle").setAttribute("aria-label", label);
  tooltips.set($("candidates-toggle"), label);
  if (showCandidates && !scene.vectors.plan) requestPreview();
};
$("new-world").onclick = () => resetWorld(Math.floor(Math.random() * 999999));
$("world-select").onchange = (e) =>
  resetWorld(Math.floor(Math.random() * 999999), e.target.value);
$("retry-drive").onclick = () => {
  resetWorld();
  $("autopilot").focus();
};
$("crash-new-world").onclick = () =>
  resetWorld(Math.floor(Math.random() * 999999));
$("crash-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("camera").onclick = changeCamera;
$("pause").onclick = togglePause;
$("resume").onclick = togglePause;
$("next-trip").onclick = () => resetWorld(Math.floor(Math.random() * 999999));
$("keep-driving").onclick = () => {
  sim.complete = false;
  sim.freeExplore = true;
  $("arrival").hidden = true;
};
$("map-toggle").onclick = () => {
  $("minimap").hidden = !$("minimap").hidden;
  $("map-toggle").setAttribute("aria-pressed", String(!$("minimap").hidden));
  tooltips.set(
    $("map-toggle"),
    `${$("minimap").hidden ? "Show" : "Hide"} route map`,
  );
  minimap.constrainPosition();
  drawMap();
};
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("Use your browser’s fullscreen shortcut.");
  }
};
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").innerHTML = icon(
    document.fullscreenElement ? "minimize" : "maximize",
  );
  $("fullscreen").setAttribute(
    "aria-label",
    document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
  );
  tooltips.set($("fullscreen"), $("fullscreen").getAttribute("aria-label"));
  createIcons({ icons });
});
window.addEventListener("keydown", (e) => {
  if (sim.crash || loading) return;
  if ($("json-dialog").open || $("help-dialog").open) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.target.closest("button") && ["Space", "Enter"].includes(e.code)) return;
  const driving = [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ];
  if (driving.includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
    if (sim.autopilot) setPilot(false);
  }
  if (e.repeat) return;
  if (e.code === "KeyJ") setPilot(!sim.autopilot);
  if (e.code === "KeyC") changeCamera();
  if (e.code === "KeyP") togglePause();
  if (e.key === "?") {
    e.preventDefault();
    touch.reset();
    $("help-dialog").showModal();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    generation++;
    keys.clear();
    sim.player.target = 0;
    lastApplied = 0;
    nextDecision = 0;
  }
});
$("close-help").onclick = () => $("help-dialog").close();
$("scene-json").onclick = () => {
  touch.reset();
  $("json-dialog").showModal();
  renderJSON();
};
$("close-json").onclick = () => $("json-dialog").close();
document.querySelectorAll("[data-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      inspectorTab = button.dataset.tab;
      inspectFrozen = false;
      syncFreeze();
      document
        .querySelectorAll("[data-tab]")
        .forEach((b) => b.classList.toggle("active", b === button));
      $("json-description").textContent = {
        request:
          "Exact Jev API payload, including instructions and offered choices. Full geometry and control details stay local.",
        sensor:
          "Complete forward perception, route guidance, geometry predictions and vehicle telemetry.",
        world:
          "All roads, buildings, vehicles, pedestrians, controls, and the current route.",
        decision:
          "Actual Jev probabilities and token usage. Costs accumulate across every completed call.",
      }[inspectorTab];
      renderJSON();
    }),
);
function syncFreeze() {
  $("freeze-json").textContent = inspectFrozen ? "Resume" : "Freeze";
  $("json-live").textContent = inspectFrozen ? "FROZEN" : "LIVE · 4 Hz";
}
$("freeze-json").onclick = () => {
  inspectFrozen = !inspectFrozen;
  syncFreeze();
};
function inspectRequest(state) {
  const { request, fixed } = prepareJevRequest(state);
  return Object.keys(request.questions).length
    ? request
    : {
        status: "No Jev call needed: only one eligible action.",
        resolved_locally: fixed,
      };
}
function updateCredits(credits) {
  if (!credits) return;
  playCredits = credits;
  $("cost-label").textContent = "Play credit";
}
$("credit-close").onclick = () => $("credit-dialog").close();
$("jev-key").onclick = () => openKeyDialog();
$("key-close").onclick = () => $("key-dialog").close();
$("key-save").onclick = () => {
  const value = $("jev-key-input").value.trim();
  if (!value) {
    toast("Paste a key first.", "error");
    return;
  }
  try {
    localStorage.setItem(JEV_KEY_STORAGE, value);
  } catch {
    toast("Could not save the key in this browser.", "error");
    return;
  }
  $("jev-key-input").value = "";
  configured = true;
  refreshKeyButton();
  $("key-dialog").close();
  toast("Jev key saved. Press J to engage autopilot.");
};
$("key-clear").onclick = () => {
  try {
    localStorage.removeItem(JEV_KEY_STORAGE);
  } catch {
    /* storage unavailable — key already effectively gone */
  }
  refreshKeyButton();
  openKeyDialog();
};
let voiceRec = null,
  voiceListening = false,
  voiceInterim = "",
  lastVoiceFire = 0,
  voiceRestarts = [];
const voiceLog = [];
function logVoiceMic(event, detail) {
  voiceLog.unshift({ mic: event, ...(detail ? { detail } : {}) });
  voiceLog.splice(20);
}
function refreshVoiceButton() {
  const button = $("voice");
  if (!button) return;
  button.classList.toggle("listening", voiceListening);
  tooltips.set(
    button,
    voiceListening
      ? "Listening… speak now"
      : "Voice: faster, slower, left, right, U-turn",
  );
}
function toggleVoice() {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("Voice input is not supported in this browser.", "error");
    return;
  }
  if (voiceListening) {
    // Manual stop: clear the flag first so onend doesn't auto-restart.
    voiceListening = false;
    voiceInterim = "";
    refreshVoiceButton();
    try {
      voiceRec.stop();
    } catch {
      /* already stopped */
    }
    return;
  }
  voiceRec = new Recognition();
  voiceRec.lang = "en-US";
  // Continuous + interim = realtime feel: commands fire while you speak
  // instead of waiting for one short clip to finish.
  voiceRec.continuous = true;
  voiceRec.interimResults = true;
  // Rank several alternatives: Manglish accents often land the command
  // in 2nd/3rd place, and we match mishearings (write→right…).
  voiceRec.maxAlternatives = 5;
  // Bias the recognizer toward our tiny EN+MS vocabulary where supported.
  try {
    const GrammarList =
      window.SpeechGrammarList || window.webkitSpeechGrammarList;
    if (GrammarList) {
      const grammars = new GrammarList();
      grammars.addFromString(voiceGrammarSrc(), 1);
      voiceRec.grammars = grammars;
    }
  } catch {
    /* grammar unsupported — keyword matching still applies */
  }
  const fireVoiceCommand = (cmd, text) => {
    sim.setVoice(cmd);
    lastVoiceFire = performance.now();
    voiceLog.unshift({
      at_sim_s: Math.round(sim.time * 10) / 10,
      heard: text.trim(),
      command: VOICE_COMMANDS[cmd].label,
      jev: null,
    });
    voiceLog.splice(20);
    toast(`Voice: ${VOICE_COMMANDS[cmd].label} — “${text.trim()}”`);
  };
  voiceRec.onresult = (event) => {
    const finals = [];
    let interim = "";
    // Only results new since the last event; interim shows live.
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i],
        alts = [...result].map((alt) => alt.transcript);
      if (result.isFinal) finals.push(...alts);
      else if (alts[0]) interim += `${alts[0]} `;
    }
    voiceInterim = interim.trim();
    // Realtime: fire on interim matches too (2.5 s cooldown per command).
    if (voiceInterim && performance.now() - lastVoiceFire > 2500) {
      const live = parseVoiceCommand(voiceInterim);
      if (live && VOICE_COMMANDS[live]) {
        const heard = voiceInterim;
        voiceInterim = "";
        fireVoiceCommand(live, heard);
        return;
      }
    }
    if (!finals.length) return;
    voiceInterim = "";
    const found = parseVoiceAlternatives(finals);
    if (found && VOICE_COMMANDS[found.cmd]) {
      fireVoiceCommand(found.cmd, found.text);
    } else
      toast(
        `Didn't catch that: “${(finals[0] || "").trim()}” — try: faster, slower, left, right, U-turn`,
        "error",
      );
  };
  voiceRec.onend = () => {
    voiceInterim = "";
    // Chrome ends sessions on pauses — auto-restart while toggled on.
    if (voiceListening) {
      const now = performance.now();
      voiceRestarts = voiceRestarts.filter((t) => now - t < 10000);
      if (voiceRestarts.length >= 5) {
        voiceListening = false;
        refreshVoiceButton();
        logVoiceMic("restart-loop");
        toast("Mic keeps dropping — tap voice to retry.", "error");
        return;
      }
      voiceRestarts.push(now);
      try {
        voiceRec.start();
      } catch {
        voiceListening = false;
        refreshVoiceButton();
      }
      return;
    }
    refreshVoiceButton();
  };
  const MIC_ERRORS = {
    "not-allowed":
      "Mic blocked — allow the microphone for this site, then tap voice again.",
    "audio-capture": "No microphone found on this device.",
    network: "Speech recognition needs internet — check your connection.",
    "service-not-allowed": "Speech service blocked in this browser.",
  };
  voiceRec.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    logVoiceMic("error", event.error);
    toast(MIC_ERRORS[event.error] ?? `Mic error: ${event.error}`, "error");
  };
  voiceRec.onstart = () => logVoiceMic("listening");
  try {
    voiceRec.start();
    voiceListening = true;
    refreshVoiceButton();
  } catch {
    toast("Could not start the mic.", "error");
  }
}
$("voice").onclick = () => toggleVoice();
// ---- Background music (Kompang Cruise), on from the first tap ----
const MUSIC_STORAGE = "kancil.music_on";
let musicOn = true;
try {
  musicOn = localStorage.getItem(MUSIC_STORAGE) !== "off";
} catch {
  /* storage unavailable: default on */
}
const bgm = new Audio("/KompangCruise.mp3");
bgm.loop = true;
bgm.volume = 0.35;
function refreshMusicButton() {
  const button = $("music");
  if (!button) return;
  button.classList.toggle("muted", !musicOn);
  tooltips.set(button, musicOn ? "Mute background music" : "Play background music");
}
function applyMusic() {
  refreshMusicButton();
  if (!musicOn) {
    bgm.pause();
    return;
  }
  bgm.play().catch(() => {
    /* autoplay blocked until the next user gesture */
  });
}
$("music").onclick = () => {
  musicOn = !musicOn;
  try {
    localStorage.setItem(MUSIC_STORAGE, musicOn ? "on" : "off");
  } catch {
    /* ignore */
  }
  applyMusic();
};
refreshMusicButton();
// ---- Chase taunts: the pack talks smack while it hunts ----
// Random rotation across the three clips, never the same twice in a row,
// with playback-rate jitter so even repeats sound a little different.
const TAUNTS = ["/apalumau.mp3", "/apalumau2.mp3", "/apalumau3.mp3"];
const tauntAudio = TAUNTS.map((src) => {
  const clip = new Audio(src);
  clip.preload = "auto";
  return clip;
});
let lastTaunt = -1,
  nextTauntAt = 0;
function playTaunt() {
  if (!musicOn) return;
  let pick = 0;
  if (tauntAudio.length > 1)
    do {
      pick = Math.floor(Math.random() * tauntAudio.length);
    } while (pick === lastTaunt);
  lastTaunt = pick;
  const clip = tauntAudio[pick];
  try {
    clip.playbackRate = 0.92 + Math.random() * 0.16;
    clip.currentTime = 0;
    clip.play().catch(() => {
      /* autoplay blocked until first tap */
    });
  } catch {
    /* audio unavailable */
  }
}
// ---- Crash bang: synthesized noise burst + metallic drop, no asset ----
let crashAudio = null;
function playCrashSound(impactMps = 5) {
  try {
    crashAudio ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = crashAudio;
    if (ctx.state === "suspended") ctx.resume();
    const dur = 0.5,
      buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 750;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.6, 0.25 + impactMps * 0.02);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.3);
    const clang = ctx.createGain();
    clang.gain.setValueAtTime(0.1, ctx.currentTime);
    clang.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(clang);
    clang.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* audio unavailable */
  }
}
// ---- Intro showroom: goal, 3D car preview, picker, voice, start ----
let heroChoice =
    HERO_MODELS.some((m) => m.id === params.get("car"))
      ? params.get("car")
      : "stripe-myvi",
  introShown = false,
  preview = null,
  previewIndex = Math.max(
    0,
    HERO_MODELS.findIndex((m) => m.id === heroChoice),
  ),
  previewSpin = 0,
  previewIdle = 0,
  previewCarId = null;
function previewScene() {
  if (preview) return preview;
  const canvas = $("car-preview"),
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene3d = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 520 / 300, 0.1, 100);
  camera.position.set(4.6, 2.1, -5.4);
  camera.lookAt(0, 0.7, 0);
  scene3d.add(new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 7, -3);
  scene3d.add(sun);
  const holder = new THREE.Group();
  scene3d.add(holder);
  preview = { renderer, scene3d, camera, holder };
  let dragging = false,
    lastX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    previewSpin += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
    previewIdle = 0;
  });
  const stop = () => (dragging = false);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  return preview;
}
async function setPreviewCar(id) {
  const spec = HERO_MODELS.find((m) => m.id === id) ?? HERO_MODELS[0];
  previewIndex = HERO_MODELS.indexOf(spec);
  heroChoice = spec.id;
  $("car-name").textContent = spec.label;
  [...$("car-dots").children].forEach((dot, i) =>
    dot.classList.toggle("active", i === previewIndex),
  );
  if (previewCarId === spec.id) return;
  previewCarId = spec.id;
  const { holder } = previewScene();
  holder.traverse((mesh) => mesh.geometry?.dispose?.());
  holder.clear();
  try {
    holder.add(await loadHeroCar(spec.id));
  } catch (error) {
    console.warn("Preview model unavailable", spec.id, error);
  }
}
function renderPreview(dt) {
  if ($("intro-overlay").hidden || !preview || !preview.holder.children.length)
    return;
  previewIdle += dt;
  if (previewIdle > 2) previewSpin += dt * 0.35;
  preview.holder.rotation.y = previewSpin;
  preview.renderer.render(preview.scene3d, preview.camera);
}
function showIntro() {
  if (introShown) return;
  introShown = true;
  sim.paused = true;
  $("paused-overlay").hidden = true;
  if (!$("car-dots").children.length)
    for (const spec of HERO_MODELS) {
      const dot = document.createElement("button");
      dot.setAttribute("aria-label", spec.label);
      dot.onclick = () => setPreviewCar(spec.id);
      $("car-dots").append(dot);
    }
  setPreviewCar(heroChoice);
  $("intro-overlay").hidden = false;
  syncPilot();
  updateUI();
}
$("car-prev").onclick = () =>
  setPreviewCar(
    HERO_MODELS[(previewIndex + HERO_MODELS.length - 1) % HERO_MODELS.length].id,
  );
$("car-next").onclick = () =>
  setPreviewCar(HERO_MODELS[(previewIndex + 1) % HERO_MODELS.length].id);
$("voice-intro").onclick = () => toggleVoice();
$("start-drive").onclick = async () => {
  const button = $("start-drive");
  button.disabled = true;
  button.textContent = "Preparing…";
  applyMusic();
  try {
    await scene.setHeroModel(heroChoice);
  } catch (error) {
    toast("Could not load that car.", "error");
  }
  $("intro-overlay").hidden = true;
  sim.paused = false;
  touch.sync();
  generation++;
  lastApplied = 0;
  nextDecision = 0;
  button.disabled = false;
  button.textContent = "Start drive";
  updateUI();
};
$("key-test").onclick = async () => {
  // Validate the typed (or saved) key against TypeSafe without driving.
  const candidate = $("jev-key-input").value.trim() || getJevKey();
  if (!candidate) {
    $("jev-key-status").textContent = "Paste a key first, then Test.";
    return;
  }
  $("jev-key-status").textContent = "Checking with TypeSafe…";
  try {
    const res = await fetch("/api/key-check", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-jev-key": candidate,
      },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    $("jev-key-status").textContent = data.ok
      ? "Key accepted by TypeSafe — save it and press J."
      : data.error || "Key check failed.";
  } catch {
    $("jev-key-status").textContent = "Could not reach the server.";
  }
};
$("sign-out").onclick = async () => {
  setPilot(false);
  sim.paused = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error();
    location.assign("/login");
  } catch {
    toast("Could not sign out. Please try again.", "error");
  }
};
function updateCostTooltip(pricing) {
  const averages = tally.calls
    ? `${Math.round(tally.input / tally.calls).toLocaleString()} input tokens/call · ${(tally.request_bytes / tally.calls / 1024).toFixed(1)} KB/call. `
    : "";
  tooltips.set(
    document.querySelector(".cost-total"),
    `${playCredits ? "Remaining from your one-time $0.25 allowance. " : ""}${averages}Estimated from Jev-reported tokens at $${pricing.input_per_million}/M input and $${pricing.output_per_million}/M output.`,
  );
}
function inspectData() {
  if (inspectorTab === "request") {
    if (
      !sim.lastDecisionState ||
      (!sim.autopilot && !showCandidates && !sim.paused)
    )
      requestPreview();
    return (
      lastInput ||
      (sim.lastDecisionState
        ? inspectRequest(sim.lastDecisionState)
        : { status: "Preparing driving state…" })
    );
  }
  if (inspectorTab === "decision")
    return {
      response: lastDecision,
      last_submitted_input: lastInput,
      session: {
        ...tally,
        average_input_tokens: tally.calls
          ? Math.round(tally.input / tally.calls)
          : 0,
        average_request_bytes: tally.calls
          ? Math.round(tally.request_bytes / tally.calls)
          : 0,
      },
    };
  if (inspectorTab === "voice")
    return voiceLog.length
      ? { log: voiceLog }
      : {
          status:
            "No voice commands yet — tap the mic and say: faster, slower, left, right, U-turn.",
          log: [],
        };
  return sim.observation(inspectorTab === "world");
}
let copyFeedbackTimer;
$("copy-json").onclick = async () => {
  // Copy exactly the snapshot on screen, including when the inspector is frozen.
  const text = $("json-content").textContent;
  const button = $("copy-json");
  clearTimeout(copyFeedbackTimer);
  button.disabled = true;
  try {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Keep the fallback inside the modal so it can receive focus for copying.
      const field = document.createElement("textarea");
      field.value = text;
      field.readOnly = true;
      field.style.cssText = "position:fixed;left:-9999px;top:0";
      $("json-dialog").append(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw Error("Clipboard unavailable");
      } finally {
        field.remove();
      }
    }
    $("copy-json-label").textContent = "Copied!";
  } catch {
    inspectFrozen = true;
    syncFreeze();
    const range = document.createRange();
    range.selectNodeContents($("json-content"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $("copy-json-label").textContent = "Press ⌘C / Ctrl+C";
  } finally {
    button.disabled = false;
    button.focus({ preventScroll: true });
    copyFeedbackTimer = setTimeout(() => {
      $("copy-json-label").textContent = "Copy";
    }, 3000);
  }
};
$("download-json").onclick = () => {
  const text = inspectFrozen
      ? $("json-content").textContent
      : JSON.stringify(inspectData(), null, 2),
    a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = `jev-${inspectorTab}-${sim.world.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
function renderJSON() {
  if (inspectFrozen) return;
  const text = JSON.stringify(inspectData(), null, 2);
  $("json-content").innerHTML = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(?:\\.|[^"\\])*"\s*:?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      (m) =>
        `<span class="${m.startsWith('"') ? (m.endsWith(":") ? "json-key" : "json-string") : /true|false|null/.test(m) ? "json-bool" : "json-number"}">${m}</span>`,
    );
}
async function decide() {
  if (
    loading ||
    busy ||
    !sim.autopilot ||
    sim.paused ||
    document.hidden ||
    sim.complete ||
    sim.crash
  )
    return;
  const now = performance.now();
  if (now < nextDecision) {
    if (errors || now < nextContextCheck || now - lastApplied < 250) return;
    nextContextCheck = now + 100;
    // Recheck lights/stop memory early while the normal cadence is relaxed.
    if (!lastContext || !sim.decisionContextChanged(lastContext)) return;
  }
  busy = true;
  const token = generation,
    started = performance.now();
  try {
    const planned = await refreshPlan();
    if (
      !planned ||
      token !== generation ||
      !sim.autopilot ||
      sim.paused ||
      sim.crash
    )
      return;
    const { state, plan } = planned;
    scene.vectors.setCandidates(plan);
    lastInput = inspectRequest(state);
    const res = await fetch("/api/decide", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(getJevKey() ? { "x-jev-key": getJevKey() } : {}),
        },
        body: JSON.stringify({ state, request_id: crypto.randomUUID() }),
        signal: AbortSignal.timeout(12000),
      }),
      data = await res.json();
    updateCredits(data.credits);
    if (res.status === 401 && authRequired) {
      setPilot(false);
      location.assign("/login");
      return;
    }
    if (res.status === 402 && authRequired) {
      setPilot(false);
      $("credit-dialog").showModal();
      return;
    }
    if (res.status === 503 && !authRequired && !hasJevKey()) {
      setPilot(false);
      toast(data.error || "Add your Jev key to drive with autopilot.", "error");
      openKeyDialog();
      return;
    }
    if (res.status === 401 && !authRequired && hasJevKey()) {
      setPilot(false);
      toast("Jev rejected the saved key. Check it and try again.", "error");
      openKeyDialog();
      return;
    }
    if (!res.ok) throw Error(data.error || "Jev request failed");
    if (data.decision_source === "only_eligible_action")
      tally.constrained_steps++;
    else tally.calls++;
    tally.request_bytes += data.request_bytes ?? 0;
    tally.cost += data.cost_usd;
    tally.input += data.usage.input_tokens;
    tally.output += data.usage.output_tokens;
    updateCostTooltip(data.pricing);
    tally.latencies.push(data.latency_ms);
    if (tally.latencies.length > 25) tally.latencies.shift();
    if (
      token !== generation ||
      state.route_version !== sim.routeVersion ||
      !sim.autopilot ||
      sim.paused ||
      sim.crash
    )
      return;
    const controls = decisionControls(state, data);
    if (!controls) throw Error("Jev returned a mismatched candidate batch.");
    const now = performance.now();
    if (now - started > 1800)
      throw Error("Jev decision expired before it arrived. Replanning.");
    if (sim.decisionContextChanged(state)) {
      // A changed light or a newly completed stop needs another Jev decision.
      // Keep the previous maneuver briefly instead of inserting a new brake.
      nextDecision = 0;
      return;
    }
    if (
      data.answers.route?.choice &&
      data.answers.route.choice !== "keep" &&
      sim.chooseRoute(data.answers.route.choice)
    ) {
      nextDecision = 0;
      return;
    }
    if (lastApplied) tally.intervals.push(now - lastApplied);
    if (tally.intervals.length > 20) tally.intervals.shift();
    lastDecision = { ...data, received_at_simulation_s: sim.time };
    // Link Jev's answer back to the latest voice command still waiting.
    const pendingVoice = voiceLog.find((entry) => !entry.jev);
    if (pendingVoice) {
      pendingVoice.jev = {
        choice: data.selection?.choice ?? data.answers?.vector?.choice ?? null,
        confidence:
          data.selection?.confidence ??
          data.answers?.vector?.confidence ??
          null,
        latency_ms: data.latency_ms,
      };
    }
    lastContext = state;
    lastApplied = now;
    errors = 0;
    sim.player.maneuver = state.vectors[data.selection.choice];
    sim.player.steering = controls.steering;
    sim.player.target = controls.velocity;
    scene.vectors.setAnswer(data.selection, plan);
    nextDecision = started + decisionInterval(state);
  } catch (error) {
    if (token === generation) {
      sim.player.target = 0;
      scene.vectors.clear();
      errors++;
      if (error.message.includes("expired")) lastExpireAt = performance.now();
      nextDecision = performance.now() + Math.min(15000, 1000 * 2 ** errors);
      toast(error.message, "error");
      sim.event(error.message, "error");
      if (errors >= 3) {
        setPilot(false);
        toast(
          "Jev paused after three failed requests. Toggle autopilot to reconnect.",
          "error",
        );
      }
    }
  } finally {
    busy = false;
  }
}
function drawMap() {
  const w = sim.world,
    v = sim.player,
    W = 380,
    H = 310;
  const view = minimap.view(),
    scale = view.scale;
  const pt = (p) => [
    (p.x - view.center.x) * scale,
    (p.z - view.center.z) * scale,
  ];
  map.clearRect(0, 0, W, H);
  map.fillStyle = "#f3f4f6";
  map.fillRect(0, 0, W, H);
  map.save();
  map.translate(W / 2, H * 0.65);
  map.rotate(-view.heading);
  map.lineCap = "round";
  map.strokeStyle = "#d0d3d8";
  if (w.roadSamples) {
    map.lineWidth = 25 * scale;
    map.beginPath();
    w.roadSamples.forEach((p, i) =>
      i ? map.lineTo(...pt(p)) : map.moveTo(...pt(p)),
    );
    map.stroke();
  }
  if (w.connectorRoads) {
    for (const road of w.connectorRoads) {
      map.lineWidth = road.width * scale;
      map.beginPath();
      road.points.forEach((p, i) =>
        i ? map.lineTo(...pt(p)) : map.moveTo(...pt(p)),
      );
      map.stroke();
    }
  } else if (!w.roadSamples)
    for (const e of w.edges) {
      map.lineWidth = e.width * scale;
      map.beginPath();
      map.moveTo(...pt(w.byId[e.a]));
      map.lineTo(...pt(w.byId[e.b]));
      map.stroke();
    }
  map.strokeStyle = "#3e6ae1";
  map.lineWidth = 4;
  map.beginPath();
  w.route.points.forEach((p, i) =>
    i ? map.lineTo(...pt(p)) : map.moveTo(...pt(p)),
  );
  map.stroke();
  for (const car of sim.traffic) {
    map.fillStyle = car.type === "motorcycle" ? "#e82127" : "#81858d";
    map.beginPath();
    map.arc(...pt(car), 4, 0, Math.PI * 2);
    map.fill();
  }
  const end = pt(w.route.points.at(-1));
  map.fillStyle = "#171a20";
  map.fillRect(end[0] - 3, end[1] - 6, 8, 7);
  map.fillRect(end[0] - 3, end[1] - 6, 1, 14);
  // Following keeps the car pointed up; a panned map keeps its own heading.
  map.save();
  map.translate(...pt(v));
  map.rotate(v.heading);
  map.fillStyle = "#ffffff";
  map.beginPath();
  map.arc(0, 0, 13, 0, Math.PI * 2);
  map.fill();
  map.fillStyle = "#171a20";
  map.beginPath();
  map.moveTo(0, -10);
  map.lineTo(7, 7);
  map.lineTo(0, 4);
  map.lineTo(-7, 7);
  map.closePath();
  map.fill();
  map.restore();
  map.restore();
}

function updateUI() {
  const v = sim.player,
    nav = sim.navigation();
  $("speed").textContent = Math.round(Math.abs(v.speed) * 3.6);
  $("speed-limit").textContent = Math.round(
    (nav.speed_limit_mps ?? sim.world.theme.limit) * 3.6,
  );
  $("remaining").textContent =
    nav.remaining_m >= 1000
      ? `${(nav.remaining_m / 1000).toFixed(1)} km`
      : `${Math.round(nav.remaining_m)} m`;
  $("next-maneuver").textContent =
    nav.instruction ||
    (nav.next_turn === "arrive"
      ? sim.world.type === "highway"
        ? "Follow Interstate 08"
        : "Destination ahead"
      : nav.next_turn === "straight"
        ? "Continue straight"
        : nav.next_turn === "uturn"
          ? "Make a U-turn"
          : `Turn ${nav.next_turn}`);
  $("turn-distance").textContent =
    nav.next_turn === "arrive"
      ? "to your destination"
      : `in ${Math.round(nav.turn_distance_m)} m`;
  const turnIcon = {
    uturn: "rotate-ccw",
    left: "corner-up-left",
    right: "corner-up-right",
    straight: "arrow-up",
    arrive: "flag",
    merge: "corner-up-left",
    exit: "corner-up-right",
  }[nav.next_turn];
  if ($("turn-icon").dataset.icon !== turnIcon) {
    $("turn-icon").innerHTML = icon(turnIcon);
    $("turn-icon").dataset.icon = turnIcon;
    createIcons({ icons });
  }
  const answer = lastDecision?.selection,
    stale = !lastApplied || performance.now() - lastApplied > 1800;
  $("pilot-state").textContent = sim.autopilot
    ? stale
      ? "Reading the road…"
      : `${candidateName(scene.vectors.answeredPlan?.vectors[answer.choice])} · ${Math.round(answer.confidence * 100)}%`
    : sim.crash
      ? "Drive ended"
      : "Free play";
  $("context-message").textContent = sim.autopilot
    ? sim.brakeReason
      ? `Safety brake · ${sim.brakeReason}`
      : stale
        ? "Waiting for a fresh decision"
        : `${Math.round(v.target * 3.6)} km/h target · ${lastDecision.latency_ms} ms`
    : touch.available
      ? "Drag to drive · Hold Brake to stop"
      : "WASD to drive · Space to brake";
  if (
    sim.autopilot &&
    !stale &&
    !sim.brakeReason &&
    v.speed < 0.5 &&
    v.target < 0.5
  ) {
    $("context-message").textContent =
      lastDecision.decision_source === "only_eligible_action"
        ? "Only stop is available · rechecking scene"
        : "Jev chose to wait · evaluating traffic";
  }
  if (nav.rerouted)
    $("context-message").textContent =
      "Route recalculated · continuing to your destination";
  else if (rerouting && sim.routeChoiceNeeded())
    $("context-message").textContent = "Recalculating route…";
  else if (sim.lastPlan?.recovery.active)
    $("context-message").textContent = sim.lastPlan.road.on_road
      ? "Returning to the route"
      : "Finding a way back onto the road";
  if (sim.caught) {
    const by = sim.caught.by ? `the ${sim.caught.by}` : "a chaser";
    const times = sim.caught.by
      ? ` (x${sim.chaseStats.caught[sim.caught.by] ?? 1})`
      : "";
    $("context-message").textContent = `Tagged by ${by}${times} — chase resumes in 3s`;
    if (chaseToast !== "caught") {
      chaseToast = "caught";
      playTaunt();
      toast(`The ${sim.caught.by ?? "chaser"} tagged you${times}!`, "error");
    }
  } else if (sim.escaped) {
    $("context-message").textContent =
      `You escaped the chase pack (#${sim.chaseStats.rounds}) — nicely driven`;
    if (chaseToast !== "escaped") {
      chaseToast = "escaped";
      toast("You escaped the chase pack!");
    }
  } else if (sim.activeChaser() && sim.pursuerGap() < 45) {
    if (chaseToast === "caught") {
      toast("The pack is back on you!");
      playTaunt();
    }
    chaseToast = "";
    const who = sim.activeChaser().label ?? sim.activeChaser().model ?? "chaser";
    $("context-message").textContent +=
      ` · Chase #${sim.chaseStats.rounds} · ${who} on your tail — escape!`;
    // While they're right on the bumper, talk smack every 12–20 s.
    if (sim.pursuerGap() < 20 && sim.time > nextTauntAt) {
      nextTauntAt = sim.time + 12 + Math.random() * 8;
      playTaunt();
    }
  } else chaseToast = "";
  const voiceCmd = sim.voiceBias().cmd;
  if (voiceCmd && VOICE_COMMANDS[voiceCmd])
    $("context-message").textContent += ` · 🎤 ${VOICE_COMMANDS[voiceCmd].label}`;
  else if (voiceListening && voiceInterim)
    $("context-message").textContent += ` · 🎤 “${voiceInterim}”`;
  if (performance.now() - lastExpireAt < 2500)
    $("context-message").textContent += " · Decision expired — replanning";
  // Proximity banner: lights up as the pack closes, with live meters.
  // Under 20 m it becomes the break-the-rules-to-survive mode banner.
  const banner = $("chase-banner"),
    hunter = sim.activeChaser?.() ?? null,
    gapM = hunter ? Math.max(0, Math.round(sim.pursuerGap())) : Infinity;
  if (banner) {
    if (!hunter || sim.caught || sim.escaped || gapM > 60) {
      banner.hidden = true;
    } else {
      const who = hunter.label ?? hunter.model ?? "chaser",
        survive = gapM < 20;
      banner.hidden = false;
      banner.textContent = survive
        ? `🏃 BREAK-THE-RULES MODE · ${who} ${gapM} m`
        : `⚠ ${who} ${gapM} m behind`;
      banner.classList.toggle("critical", survive || gapM < 15);
      // The nearer, the more solid the warning.
      banner.style.opacity = String(
        survive ? 1 : 0.45 + 0.55 * (1 - gapM / 60),
      );
    }
  }
  $("cost").textContent = playCredits
    ? `$${Math.max(0, playCredits.remaining_usd).toFixed(4)}`
    : `$${tally.cost.toFixed(6)}`;
  $("jev-ms").textContent =
    sim.autopilot && lastDecision?.latency_ms != null
      ? `${lastDecision.latency_ms} ms`
      : "";
  if (sim.complete && !sim.freeExplore) {
    $("arrival").hidden = false;
    $("arrival-summary").textContent =
      `${Math.round(sim.distance)} m driven · ${sim.collisions} contacts · ${sim.violations} violations`;
    if ($("autopilot").getAttribute("aria-checked") === "true") {
      generation++;
      syncPilot();
    }
  }
  if ($("json-dialog").open) renderJSON();
}
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastNow) / 1000, 0.2);
  lastNow = now;
  if (document.hidden || loading) return;
  touch.sync();
  if (!sim.paused && !sim.crash) {
    if (!sim.autopilot) {
      let steer = 0;
      const left = keys.has("KeyA") || keys.has("ArrowLeft");
      const right = keys.has("KeyD") || keys.has("ArrowRight");
      if (left || right) steer = Number(right) - Number(left);
      let throttle = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) throttle = 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) throttle = -1;
      sim.pedals.throttle = throttle || touch.throttle;
      sim.pedals.brake = keys.has("Space") ? 1 : touch.brake;
      sim.steeringInput = steer || touch.steering;
      sim.player.target = 0;
    } else if (!lastApplied || now - lastApplied > 1800) sim.player.target = 0;
    // Preserve real elapsed time on slower displays using bounded physics substeps.
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++) sim.step(dt / steps);
  }
  if (scene.routeVersion !== sim.routeVersion) {
    scene.routeVersion = sim.routeVersion;
    generation++;
    lastApplied = 0;
    lastDecision = null;
    lastInput = null;
    lastContext = null;
    nextDecision = 0;
    scene.vectors.clear();
    const destination = sim.player.route.points.at(-1);
    scene.destination.position.set(destination.x, 0.2, destination.z);
  }
  if (sim.crash && !crashHandled) {
    crashHandled = true;
    playCrashSound(sim.crash.impact_speed_mps);
    generation++;
    keys.clear();
    scene.vectors.clear();
    syncPilot();
    $("arrival").hidden = true;
    $("paused-overlay").hidden = true;
    $("json-dialog").close();
    $("help-dialog").close();
    document.body.classList.add("crashed");
    $("crash-description").textContent = {
      building: "You collided with a building.",
      pedestrian: "You struck a pedestrian.",
      car: "You collided with another car.",
      motorcycle: "You collided with a motorcycle.",
    }[sim.crash.type];
    $("crash-speed").textContent = Math.round(sim.crash.impact_speed_mps * 3.6);
    $("crash-distance").textContent = Math.round(sim.distance);
    $("crash-dialog").showModal();
  }
  if (
    showCandidates &&
    !sim.autopilot &&
    !sim.paused &&
    !sim.crash &&
    now - candidatePreviewAt > 500
  ) {
    candidatePreviewAt = now;
    requestPreview();
  }
  scene.render(dt);
  renderPreview(dt);
  if (!$("minimap").hidden && now - lastMapDraw >= 100) {
    drawMap();
    lastMapDraw = now;
  }
  uiTime += dt;
  if (uiTime > 0.2) {
    uiTime = 0;
    updateUI();
  }
}
refreshWorld();
syncPilot();
updateUI();
requestAnimationFrame(animate);
finishLoading().catch(loadingFailed);
setInterval(decide, 25);
fetch("/api/status", { credentials: "same-origin" })
  .then((r) => r.json())
  .then((data) => {
    authRequired = data.auth_required !== false;
    if (authRequired && data.authenticated !== true) {
      location.replace("/login");
      return;
    }
    updateCredits(data.credits);
    $("sign-out").hidden = !data.authenticated;
    if (data.user) tooltips.set($("sign-out"), `Sign out · ${data.user.email}`);
    configured = data.configured || (!authRequired && hasJevKey());
    refreshKeyButton();
    updateCostTooltip(data.pricing);
    if (!configured && !authRequired) {
      toast("Add your Jev key (key button) or set it on the server.", "error");
      openKeyDialog();
    } else if (!configured)
      toast("Jev API key is missing. Check the server configuration.", "error");
  })
  .catch(() => {
    toast("Jev server unavailable.", "error");
  });

export { sim, scene };
