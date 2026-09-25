import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { materials, physical } from "./materials.js";
import { steeringCurvature } from "./planning.js";
import { assetManager } from "./asset-loading.js";
const BASE = import.meta.env.BASE_URL;

// Hero GLB cache lives in heroAssets (keyed by HERO_MODELS id) below.
const WHEEL_NAMES = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];

export function updateHeroWheels(model, signedDistance, steering, speed) {
  const wheelbase = model.userData.wheelbase;
  if (!wheelbase) return;
  const curvature = steeringCurvature(steering, speed);
  for (const name of WHEEL_NAMES) {
    const wheel = model.getObjectByName(name);
    if (!wheel) continue;
    const rotor = wheel.children[0];
    if (!rotor) continue;
    if (!wheel.userData.radius) continue;
    // Local -Z is forward. Calipers steer with the axle but do not roll.
    rotor.rotation.x =
      (rotor.rotation.x - signedDistance / wheel.userData.radius) %
      (Math.PI * 2);
    wheel.rotation.y = wheel.userData.front
      ? -Math.atan((wheelbase * curvature) / (1 - wheel.position.x * curvature))
      : 0;
  }
}

// Set to Math.PI if your replacement GLB faces +Z (appears to drive backwards).
const HERO_FLIP_YAW = Math.PI;

// Generic path: use any GLB even when it doesn't match the Model Y
// material/wheel layout. Moves the original meshes untouched (keeps
// materials, textures, skinning) into a normalized wrapper: length on -Z,
// ~4.75 m long, centered, grounded at y=0.
function normalizeModel(source, flipYaw, name = "hero-car-generic", sizeScale = 1) {
  const model = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(...source.children);
  if (inner.children.length === 0) throw new Error(`${name}: GLB has no meshes`);
  inner.rotation.y = flipYaw;
  model.add(inner);
  inner.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(inner);
  let size = bounds.getSize(new THREE.Vector3());
  // Most car exports have length as the longest horizontal axis. The sim
  // expects length on -Z, so yaw 90° when length arrives on X (Model Y source).
  if (size.x > size.z * 1.15) {
    inner.rotation.y += -Math.PI / 2;
    inner.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(inner);
    size = bounds.getSize(new THREE.Vector3());
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = (4.75 / Math.max(size.z, 0.001)) * sizeScale;
  inner.position.set(-center.x, -bounds.min.y, -center.z);
  model.scale.setScalar(scale);
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
  });
  const scaledHeight = size.y * scale;
  model.name = name;
  model.userData.eyeHeight = THREE.MathUtils.clamp(scaledHeight * 0.68, 1.1, 1.35);
  model.userData.eyeForward = 0.45;
  model.userData.wheelbase = 4.75 * 0.6;
  model.userData.genericModel = true;
  return model;
}

function buildGenericHeroModel(scene) {
  return normalizeModel(scene, HERO_FLIP_YAW);
}

// Traffic fleet. tesla.glb is the original rigged Model Y asset (faces -X,
// so no flip); wira/myvi/tank are single-mesh exports from the same pipeline
// as the custom model-y.glb (face +X, need the PI flip).
export const TRAFFIC_MODELS = {
  tesla: { file: `${BASE}models/model-y/tesla.glb`, flip: 0 },
  wira: { file: `${BASE}models/model-y/wira.glb`, flip: Math.PI },
  myvi: { file: `${BASE}models/model-y/myvi.glb`, flip: Math.PI },
  "yellow-myvi": { file: `${BASE}models/model-y/yellow-myvi.glb`, flip: 0, size: 0.75 },
  "red-kancil": { file: `${BASE}models/model-y/redkancil.glb`, flip: 0, size: 0.75 },
  iswara: { file: `${BASE}models/model-y/iswara.glb`, flip: 0 },
  tank: { file: `${BASE}models/model-y/tank.glb`, flip: Math.PI },
  bezza: { file: `${BASE}models/model-y/bezzabrown.glb`, flip: 0 },
  satria: { file: `${BASE}models/model-y/satria.glb`, flip: 0 },
};
const trafficAssets = new Map();

export async function loadTrafficCar(name) {
  const spec = TRAFFIC_MODELS[name];
  if (!spec) throw new Error(`Unknown traffic model: ${name}`);
  if (!trafficAssets.has(name)) {
    trafficAssets.set(
      name,
      (async () => {
        const decoder = new DRACOLoader(assetManager).setDecoderPath(`${BASE}draco/`);
        const loader = new GLTFLoader(assetManager).setDRACOLoader(decoder);
        try {
          const { scene } = await loader.loadAsync(spec.file);
          return normalizeModel(scene, spec.flip, `traffic-${name}`, spec.size ?? 1);
        } finally {
          decoder.dispose();
        }
      })(),
    );
  }
  const template = await trafficAssets.get(name);
  const model = template.clone(true);
  model.traverse((mesh) => {
    if (mesh.isMesh) mesh.geometry = mesh.geometry.clone();
  });
  return model;
}

export const HERO_MODELS = [
  { id: "iswara", label: "Iswara", file: `${BASE}models/model-y/iswara.glb`, flip: 0 },
  { id: "tesla", label: "Tesla", file: `${BASE}models/model-y/tesla.glb`, flip: 0, rigged: true },
  { id: "stripe-myvi", label: "Kancil", file: `${BASE}models/model-y/model-y.glb`, flip: 0, size: 0.75 },
  { id: "wira", label: "Wira", file: `${BASE}models/model-y/wira.glb`, flip: Math.PI },
  { id: "tank", label: "Tank", file: `${BASE}models/model-y/tank.glb`, flip: Math.PI },
  { id: "red-myvi", label: "Myvi Red", file: `${BASE}models/model-y/myvi.glb`, flip: Math.PI },
  { id: "bezza", label: "Bezza Brown", file: `${BASE}models/model-y/bezzabrown.glb`, flip: Math.PI },
  { id: "yellow-myvi", label: "Myvi Yellow", file: `${BASE}models/model-y/yellow-myvi.glb`, flip: 0, size: 0.75 },
  { id: "red-kancil", label: "Kancil Red", file: `${BASE}models/model-y/redkancil.glb`, flip: 0, size: 0.75 },
  { id: "white-myvi", label: "Myvi White", file: `${BASE}models/model-y/myvi-model-y-white-red.glb`, flip: Math.PI },
  { id: "satria", label: "Satria", file: `${BASE}models/model-y/satria.glb`, flip: 0 },
];

// Rigged builder for the original Model Y / Tesla asset. Throws when the
// source lacks the expected tire/material layout; callers fall back to
// normalizeModel so any GLB still shows up.
function buildRiggedModel(scene) {
    const paint = physical("model-y-paint", {
      color: "#e1e4e8",
      metalness: 0.35,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    const alloy = physical("model-y-alloy", {
      color: "#5c626a",
      metalness: 0.9,
      roughness: 0.28,
    });
    const glass = physical("model-y-glass", {
      color: "#192530",
      metalness: 0.25,
      roughness: 0.08,
      clearcoat: 1,
    });
    glass.name = "Glass";
    const lenses = physical("model-y-light-lenses", {
      color: "#eef4ff",
      metalness: 0.05,
      roughness: 0.1,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    const leather = physical("model-y-leather", {
      color: "#24282c",
      roughness: 0.85,
    });
    // This source faces -X. Normalize it to the simulation's -Z forward.
    scene.rotation.y = -Math.PI / 2;
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const scale = 4.75 / size.z;
    const transform = new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(
        new THREE.Matrix4().makeTranslation(
          -center.x,
          -bounds.min.y,
          -center.z,
        ),
      );
    const model = new THREE.Group();
    const batches = new Map([[model, new Map()]]);
    const wheels = new Map();
    const meshBounds = (mesh) =>
      new THREE.Box3().setFromObject(mesh).applyMatrix4(transform);
    const panes = [];
    scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (mesh.material.name === "glass_body") panes.push(meshBounds(mesh));
      if (mesh.material.name !== "tires") return;
      const box = meshBounds(mesh),
        wheelSize = box.getSize(new THREE.Vector3());
      // The four complete tire shells define exact axle centers and radii;
      // the separate sidewall lettering meshes are attached below.
      if (wheelSize.y < 0.72) return;
      const position = box.getCenter(new THREE.Vector3());
      const front = position.z < 0;
      const name = `wheel_${front ? "f" : "r"}${position.x < 0 ? "l" : "r"}`;
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.position.copy(position);
      pivot.userData.front = front;
      pivot.userData.radius = wheelSize.y / 2;
      const rotor = new THREE.Group();
      rotor.name = `${name}_spin`;
      pivot.add(rotor);
      model.add(pivot);
      wheels.set(name, { pivot, rotor });
      batches.set(rotor, new Map());
      batches.set(pivot, new Map());
    });
    if (wheels.size !== 4) throw new Error("Model Y asset is missing an axle");
    const rolling = new Set([
      "tires",
      "wheels",
      "brakedsk",
      "metal",
      "alum",
      "chrome",
    ]);
    const calipers = new Set(["calipers", "calipers2"]);
    scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const sourceMaterial = mesh.material.name;
      const box = meshBounds(mesh),
        center = box.getCenter(new THREE.Vector3()),
        extent = box.getSize(new THREE.Vector3());
      const wheelName = `wheel_${center.z < 0 ? "f" : "r"}${center.x < 0 ? "l" : "r"}`;
      const candidate = wheels.get(wheelName);
      const atAxle =
        candidate &&
        Math.abs(center.z - candidate.pivot.position.z) < 0.3 &&
        Math.abs(center.x - candidate.pivot.position.x) < 0.25 &&
        box.max.y < 0.8 &&
        extent.z < 0.8;
      const wheel =
        atAxle && (rolling.has(sourceMaterial) || calipers.has(sourceMaterial))
          ? candidate
          : null;
      // Interior glass backfaces in the source must also clear the driver's view.
      const paneLiner =
        sourceMaterial === "interior" &&
        panes.some(
          (pane) =>
            pane.min.distanceTo(box.min) < 0.025 &&
            pane.max.distanceTo(box.max) < 0.025,
        );
      if (paneLiner) return;
      let material = mesh.material;
      if (sourceMaterial === "body") material = paint;
      else if (sourceMaterial === "wheels") material = alloy;
      else if (sourceMaterial === "glass_body") material = glass;
      else if (["glass_lights", "glass_front_lights"].includes(sourceMaterial))
        material = lenses;
      else if (sourceMaterial === "interior") material = leather;
      const geometry = (
        mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone()
      ).applyMatrix4(transform.clone().multiply(mesh.matrixWorld));
      if (wheel)
        geometry.translate(
          -wheel.pivot.position.x,
          -wheel.pivot.position.y,
          -wheel.pivot.position.z,
        );
      for (const name of Object.keys(geometry.attributes))
        if (!["position", "normal", "uv"].includes(name))
          geometry.deleteAttribute(name);
      if (!geometry.attributes.uv)
        geometry.setAttribute(
          "uv",
          new THREE.BufferAttribute(
            new Float32Array(geometry.attributes.position.count * 2),
            2,
          ),
        );
      const parent = wheel
        ? calipers.has(sourceMaterial)
          ? wheel.pivot
          : wheel.rotor
        : model;
      const materialBatches = batches.get(parent);
      const geometries = materialBatches.get(material) || [];
      geometries.push(geometry);
      materialBatches.set(material, geometries);
    });
    for (const [parent, materialBatches] of batches)
      for (const [material, geometries] of materialBatches) {
        materials.set(`asset-car:${material.uuid}`, material);
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        mesh.castShadow = material !== lenses;
        mesh.receiveShadow = true;
        parent.add(mesh);
        geometries.forEach((g) => g.dispose());
      }
    scene.traverse((mesh) => mesh.geometry?.dispose());
    model.name = "tesla-model-y";
    model.userData.eyeHeight = 1.28;
    model.userData.eyeForward = 0.45;
    model.userData.wheelbase = Math.abs(
      wheels.get("wheel_fl").pivot.position.z -
        wheels.get("wheel_rl").pivot.position.z,
    );
    return model;
}

function cloneModel(template) {
  const model = template.clone(true);
  model.traverse((mesh) => {
    if (mesh.isMesh) mesh.geometry = mesh.geometry.clone();
  });
  return model;
}

async function loadHeroModel(spec) {
  const decoder = new DRACOLoader(assetManager).setDecoderPath(`${BASE}draco/`);
  const loader = new GLTFLoader(assetManager).setDRACOLoader(decoder);
  try {
    const { scene } = await loader.loadAsync(spec.file);
    if (spec.rigged) {
      try {
        return buildRiggedModel(scene);
      } catch (error) {
        console.warn(
          "Hero car rig unavailable, using generic model instead of fallback",
          error,
        );
      }
    }
    return normalizeModel(scene, spec.flip, `hero-${spec.id}`, spec.size ?? 1);
  } finally {
    decoder.dispose();
  }
}

const heroAssets = new Map();

export async function loadHeroCar(id = "iswara") {
  const spec =
    HERO_MODELS.find((m) => m.id === id) ??
    HERO_MODELS.find((m) => m.id === "iswara");
  if (!heroAssets.has(spec.id))
    heroAssets.set(spec.id, loadHeroModel(spec));
  return cloneModel(await heroAssets.get(spec.id));
}
