/*
 * Car Switcher 1.0.8 – PolyTrack 0.6.3 port of Orangy's Car Switcher 1.0.7
 * (https://github.com/0rangy/OrangysPolyMods, carswitcher/1.0.7, written for PolyTrack 0.6.2).
 *
 * Adds a "Select Car" button to the Garage that swaps the car model and, when the PML API mod is
 * installed, the engine sound. Other mods add cars by pushing
 * `{ name, url, sound, wheelPositions? }` into `pml.getMod("carswitcher").carModels` in their `init`.
 *
 * Port notes (see mods/README.md):
 *  - PolyModLoader 0.6.3 mod layout (root manifest.json + <version>/version.json), 0.6.3 PolyTypes.
 *  - The Garage button is added by watching the game's UI container for the `.customization-ui`
 *    screen instead of a chunk mixin: PolyModLoader applies only one chunk mixin per bundle and
 *    the markup is stable, the minified tokens are not.
 *  - The saved car is applied once the game has loaded instead of replacing "models/car.glb" at
 *    start-up, so a car that fails to download no longer stalls the loading screen.
 *  - Models made for PolyTrack 0.5 (a single WheelFR/FL/BR/BL mesh each, no Wheel0-11 rim styles
 *    and no Exhaust0-7 meshes) load too: their wheel mesh is used for every rim style, the vanilla
 *    exhausts fill in, and the wheel positions come from their wheel nodes.
 *  - `touchingPhysics` is only set while a car with a non-vanilla collision model is active. The
 *    game verifies the collision hull with a checksum; meshes and wheel positions are visual only,
 *    so cosmetic cars keep PolyModLoader's "vanilla physics" status (ranked play keeps working).
 *  - Webpack module ids are looked up by content with the 0.6.3 ids as fallback.
 */
import { PolyMod, MixinType } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";

const GAME = {
  /** Export list of the car module; `B` is the car class in that module, `ae` its wheel positions. */
  carModuleExport: "A: () => lt",
  carModuleId: 641,
  gltfLoaderModuleId: 7888,
  dracoLoaderModuleId: 1728,
  wheelPositionsVar: "ae",
  defaultModel: "models/car.glb",
  defaultSound: "audio/engine.mp3",
};
/** Same localStorage keys as upstream Car Switcher so saved choices carry over. */
const STORAGE_CAR = "MyCar";
const STORAGE_SOUND = "carSound";
const DEFAULT_WHEELS = {
  wheelFR: [0.627909, 0.27, 1.3478],
  wheelFL: [-0.627909, 0.27, 1.3478],
  wheelBR: [0.720832, 0.27, -1.52686],
  wheelBL: [-0.720832, 0.27, -1.52686],
};

/**
 * Evaluated inside the car module (where `B` is the car class, `c` three.js, `h` BufferGeometryUtils,
 * `w` the car styles, `nt`/`it` the collision helpers and `n` webpack's require). Mirrors the game's
 * own static `initResources`, just for a different file and with fallbacks for models made for
 * PolyTrack 0.5. Resolves to `{ hullVanilla, legacy, wheelPositions, fallbackRims, fallbackExhausts }`.
 */
const LOAD_CODE = `(async function carSwitcherLoad(url, gltfModuleId, dracoModuleId, fallback, legacyVanillaHulls) {
  const GLTFLoader = Object.values(n(gltfModuleId)).find((v) => typeof v === "function");
  const DRACOLoader = Object.values(n(dracoModuleId)).find((v) => typeof v === "function");
  const draco = new DRACOLoader();
  draco.setDecoderPath("lib/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  } finally {
    draco.dispose();
  }
  const has = (name) => gltf.scene.getObjectByName(name) != null;
  function part(name, bake) {
    const object = gltf.scene.getObjectByName(name);
    if (object == null) throw new Error('Mesh "' + name + '" does not exist');
    if (object.children.length === 0) {
      if (!(object instanceof c.eaF)) throw new Error('Mesh "' + name + '" is not a valid mesh');
      if (bake) {
        object.updateMatrixWorld(true);
        object.geometry.applyMatrix4(object.matrix.clone());
        object.geometry.computeVertexNormals();
        object.matrix.identity();
      }
      return object;
    }
    const meshes = object.children.map((child) => {
      if (!(child instanceof c.eaF)) throw new Error('Mesh "' + name + '" has invalid child meshes');
      return child;
    });
    const merged = h.pP(meshes.map((m) => m.geometry), true);
    if (bake) {
      object.updateMatrixWorld(true);
      merged.applyMatrix4(object.matrix.clone());
    }
    merged.computeVertexNormals();
    const mesh = new c.eaF(merged, meshes.map((m) => m.material));
    mesh.name = name;
    return mesh;
  }
  function doubleSided(mesh) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.side = c.hB5;
      material.shadowSide = c.hB5;
    }
    return mesh;
  }
  // PolyTrack 0.5 models ship one mesh per wheel instead of the 0.6 rim styles. The 0.5 loader
  // baked the wheel node's transform into the geometry; rims are placed by the game at run time,
  // so only the node's rotation and (absolute) scale are baked here, not its position.
  const legacyWheelName = ["WheelFR", "WheelFL", "WheelBR", "WheelBL"].find(has) ?? null;
  const legacy = !has(w.A.rims[0].model) && legacyWheelName != null;
  function legacyRimMesh(name) {
    const node = gltf.scene.getObjectByName(name);
    const mesh = part(name, false);
    node.scale.set(Math.abs(node.scale.x), Math.abs(node.scale.y), Math.abs(node.scale.z));
    node.updateMatrix();
    const matrix = node.matrix.clone();
    matrix.setPosition(0, 0, 0);
    mesh.geometry.applyMatrix4(matrix);
    mesh.geometry.computeVertexNormals();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    return doubleSided(mesh);
  }
  let legacyRim = null;
  let fallbackRims = false;
  let fallbackExhausts = false;
  const rims = new Map();
  for (let idx = 0; idx < w.A.rims.length; idx++) {
    if (!w.A.isValidRims(idx)) throw new Error("Invalid car style rims");
    const name = w.A.rims[idx].model;
    if (has(name)) rims.set(idx, doubleSided(part(name, false)));
    else if (legacyWheelName) rims.set(idx, (legacyRim ??= legacyRimMesh(legacyWheelName)));
    else if (fallback && fallback.rims && fallback.rims.has(idx)) {
      rims.set(idx, fallback.rims.get(idx));
      fallbackRims = true;
    } else throw new Error('Mesh "' + name + '" does not exist');
  }
  const exhausts = new Map();
  for (let idx = 0; idx < w.A.exhausts.length; idx++) {
    if (!w.A.isValidExhaust(idx)) throw new Error("Invalid car style exhaust");
    const name = w.A.exhausts[idx].model;
    if (has(name)) exhausts.set(idx, doubleSided(part(name, true)));
    else if (fallback && fallback.exhausts && fallback.exhausts.has(idx)) {
      exhausts.set(idx, fallback.exhausts.get(idx));
      fallbackExhausts = true;
    } else throw new Error('Mesh "' + name + '" does not exist');
  }
  // wheel positions of 0.5 models: their wheel nodes (mirrored x), symmetrised, 0.6 wheel height
  let wheelPositions = null;
  if (legacy) {
    const at = (name) => gltf.scene.getObjectByName(name)?.position ?? null;
    const fr = at("WheelFR"), fl = at("WheelFL"), br = at("WheelBR"), bl = at("WheelBL");
    if (fr && fl && br && bl) {
      const frontX = (Math.abs(fr.x) + Math.abs(fl.x)) / 2, rearX = (Math.abs(br.x) + Math.abs(bl.x)) / 2;
      const frontZ = (fr.z + fl.z) / 2, rearZ = (br.z + bl.z) / 2;
      const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
      if (inRange(frontX, 0.35, 1.4) && inRange(rearX, 0.35, 1.4) && inRange(frontZ, 0.6, 2.4) && inRange(rearZ, -2.4, -0.6)) {
        wheelPositions = { wheelFR: [frontX, 0.27, frontZ], wheelFL: [-frontX, 0.27, frontZ], wheelBR: [rearX, 0.27, rearZ], wheelBL: [-rearX, 0.27, rearZ] };
      }
    }
  }
  // collision hull: 0.5 models carry the 0.5 vanilla hull, which the 0.6 checksum rejects although
  // nobody customised it, so that known hull is swapped for the current vanilla one
  let collision = nt.call(B, part("Collision", true));
  const hullHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Float32Array(collision).buffer)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let collisionSource = "model";
  if (legacy && legacyVanillaHulls.includes(hullHash) && fallback && fallback.collisionShapeVertices) {
    collision = fallback.collisionShapeVertices;
    collisionSource = "vanilla";
  }
  B.models = {
    chassis: doubleSided(part("Body", true)),
    suspension: doubleSided(part("Suspension", true)),
    rims,
    exhausts,
    collisionShapeVertices: collision,
  };
  const hullVanilla = await it.call(B);
  return { hullVanilla, hullHash, collisionSource, legacy, wheelPositions, fallbackRims, fallbackExhausts };
})`;

/**
 * SHA-256 (as the game computes it) of the collision hull that PolyTrack 0.5 models inherited from
 * the 0.5 vanilla car. Such a hull is replaced by the current vanilla hull when loading, because it
 * was never a custom hull; any other hull is kept and reported as a physics change.
 */
const LEGACY_VANILLA_HULLS = ["dd663fb6330ed93725bf865d5eac2cd29ba19f74dbb3f67ae7f695ea1f68aed0"];

const log = {
  info: (...a) => console.log("[CarSwitcher]", ...a),
  warn: (...a) => console.warn("[CarSwitcher]", ...a),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CarSwitcherMod extends PolyMod {
  constructor() {
    super();
    /** @type {Array<{name: string, url: string, sound?: string, wheelPositions?: object}>} */
    this.carModels = [];
    /** Upstream compatibility; not used by this port. */
    this.carList = [];
    this.wheelPositions = DEFAULT_WHEELS;
    /** @type {{name: string, url: string, hullVanilla: boolean, hullHash: string, collisionSource: string, legacy: boolean} | null} */
    this.activeCar = null;
    /** Set while a car with a non-vanilla collision model is active (read by PolyModLoader). */
    this.touchingPhysics = false;
    this.physicsReason = undefined;
    this.loading = null;
    this.ids = { car: GAME.carModuleId, gltf: GAME.gltfLoaderModuleId, draco: GAME.dracoLoaderModuleId };
    this.evalInCarModule = null;
    this.vanillaModels = null;
    this.observer = null;

    const self = this;
    this.carApi = {
      getComputedCarModel: async (url) => (await this.loadTemplateModel(url)).hullVanilla,
      setNewCarTemplateModel: async (url) => (await this.loadTemplateModel(url)).hullVanilla,
      carList: this.carList,
      get templateCar() {
        return self.templateCarClass();
      },
    };

    this.preInit = (pml) => {
      this.pml = pml;
      pml.registerGlobalMixin({
        type: MixinType.INSERT,
        token: GAME.carModuleExport,
        func: ", TemplateCar: () => B, evalHere: () => (carSwitcherCode) => eval(carSwitcherCode)",
      });
    };

    this.init = (pml) => {
      this.pml = pml;
      this.ids = this.resolveModuleIds();
      const assets = `${this.modBaseUrl}/${this.modVersion}/assets`;
      this.carModels.push(
        { name: "Poly Car", url: GAME.defaultModel, sound: GAME.defaultSound, wheelPositions: DEFAULT_WHEELS },
        {
          name: "Trackmania 2020",
          url: `${assets}/tm2020.glb`,
          sound: GAME.defaultSound,
          wheelPositions: { wheelFR: [0.845606, 0.27, 1.3478], wheelFL: [-0.833504, 0.27, 1.3478], wheelBR: [0.882136, 0.27, -1.52686], wheelBL: [-0.882545, 0.27, -1.52686] },
        },
        { name: "Pingu", url: `${assets}/Pingu3.glb`, sound: "audio/click.mp3" },
        {
          name: "Trackmania Stadium",
          url: `${assets}/TMStadium.glb`,
          sound: GAME.defaultSound,
          wheelPositions: { wheelFR: [0.740905, 0.27, 1.3478], wheelFL: [-0.740905, 0.27, 1.3478], wheelBR: [0.763992, 0.27, -1.52686], wheelBL: [-0.763992, 0.27, -1.52686] },
        },
        { name: "Forklift", url: `${assets}/Forklift2.glb`, sound: GAME.defaultSound },
        {
          name: "Spooky Car",
          url: `${assets}/spookycar2.glb`,
          sound: GAME.defaultSound,
          wheelPositions: { wheelFR: [0.627909, 0.27, 1.3478], wheelFL: [-0.627909, 0.27, 1.3478], wheelBR: [0.627909, 0.27, -1.52686], wheelBL: [-0.627909, 0.27, -1.52686] },
        },
        { name: "F16", url: `${assets}/F16.glb`, sound: GAME.defaultSound },
        { name: "LightningMcQueen", url: `${assets}/McQueen.glb`, sound: GAME.defaultSound },
        {
          name: "Delorean",
          url: `${assets}/Delorean.glb`,
          sound: GAME.defaultSound,
          wheelPositions: { wheelFR: [0.545703, 0.276128, 0.921115], wheelFL: [-0.545703, 0.276128, 0.921115], wheelBR: [0.545703, 0.276128, -1.34245], wheelBL: [-0.545703, 0.276128, -1.34245] },
        },
      );
    };

    this.postInit = () => {
      this.installGarageHook();
      let savedCar = null;
      let savedSound = null;
      try {
        savedCar = localStorage.getItem(STORAGE_CAR);
        savedSound = localStorage.getItem(STORAGE_SOUND);
      } catch {
        /* storage unavailable */
      }
      if (savedCar && savedCar !== GAME.defaultModel) {
        const model = this.carModels.find((m) => m.url === savedCar) ?? { name: savedCar.split("/").pop(), url: savedCar, sound: savedSound || GAME.defaultSound };
        this.applyCar(model, { persist: false }).catch((err) => log.warn(`could not restore the saved car ${savedCar}:`, err?.message ?? err));
      } else if (savedSound && savedSound !== GAME.defaultSound) {
        this.applySound(savedSound);
      }
    };
  }

  /** Finds the webpack modules this port relies on by content, falling back to the 0.6.3 ids. */
  resolveModuleIds() {
    const ids = { car: GAME.carModuleId, gltf: GAME.gltfLoaderModuleId, draco: GAME.dracoLoaderModuleId };
    let modules = null;
    try {
      modules = this.pml.getFromPolyTrack("i.m");
    } catch {
      /* no module registry in this build */
    }
    if (!modules || typeof modules !== "object") return ids;
    for (const [id, fn] of Object.entries(modules)) {
      if (typeof fn !== "function") continue;
      const src = Function.prototype.toString.call(fn);
      if (src.includes('"models/car.glb"')) ids.car = Number(id);
      else if (src.includes("KHR_draco_mesh_compression") && src.includes("GLTFLoader")) ids.gltf = Number(id);
      else if (src.includes("draco_decoder")) ids.draco = Number(id);
    }
    return ids;
  }

  /** Evaluates code inside the car module's scope (through the exported `evalHere` hook). */
  carModuleEval() {
    if (!this.evalInCarModule) {
      const evaluator = this.pml.getFromPolyTrack(`i(${this.ids.car}).evalHere`);
      if (typeof evaluator !== "function") throw new Error("the car module hook is missing (unsupported game version?)");
      this.evalInCarModule = evaluator;
    }
    return this.evalInCarModule;
  }

  templateCarClass() {
    return this.pml.getFromPolyTrack(`i(${this.ids.car}).A`);
  }

  /**
   * Replaces the template car's meshes with the model at `url`. Waits for the game's own car
   * resources first so the start-up load cannot overwrite the swap; the vanilla meshes are kept
   * as fallbacks for models without rim or exhaust variants.
   * @returns {Promise<{hullVanilla: boolean, hullHash: string, collisionSource: "model" | "vanilla", legacy: boolean, wheelPositions: object | null}>}
   */
  async loadTemplateModel(url) {
    if (typeof url !== "string" || !url) throw new Error("a model URL is required");
    const templateCar = this.templateCarClass();
    for (let waited = 0; templateCar.models == null && waited < 60000; waited += 100) await sleep(100);
    if (templateCar.models == null) throw new Error("the game's car resources did not load");
    this.vanillaModels ??= templateCar.models;
    const load = this.carModuleEval()(LOAD_CODE);
    return load(url, this.ids.gltf, this.ids.draco, this.vanillaModels, LEGACY_VANILLA_HULLS);
  }

  applyWheelPositions(positions) {
    const vec = (p) => {
      if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v))) throw new Error("wheel positions must be [x, y, z] numbers");
      return `new c.Pq0(${p.join(", ")})`;
    };
    const v = GAME.wheelPositionsVar;
    const evalInCarModule = this.carModuleEval();
    const shapeOk = evalInCarModule(`typeof ${v} === "object" && ${v} !== null && Array.isArray(${v}.value) && ${v}.value.length === 4`);
    if (!shapeOk) {
      log.warn("wheel positions are not where this port expects them; keeping the game's values");
      return false;
    }
    evalInCarModule(`${v} = { value: [${vec(positions.wheelFR)}, ${vec(positions.wheelFL)}, ${vec(positions.wheelBR)}, ${vec(positions.wheelBL)}] }`);
    this.wheelPositions = positions;
    return true;
  }

  getWheels() {
    return this.wheelPositions;
  }

  applySound(sound) {
    const api = this.pml?.getMod?.("pmlapi");
    if (!api?.soundManager?.load) return false;
    try {
      api.soundManager.load("engine", [sound || GAME.defaultSound]);
      return true;
    } catch (err) {
      log.warn("could not change the engine sound:", err?.message ?? err);
      return false;
    }
  }

  /**
   * Loads a car, applies its wheel positions and sound, and records whether it changes the physics.
   * @param {{name: string, url: string, sound?: string, wheelPositions?: object}} model
   * @param {{persist?: boolean}} [opts]
   */
  applyCar(model, { persist = true } = {}) {
    const run = (async () => {
      const loaded = await this.loadTemplateModel(model.url);
      const hullVanilla = loaded.hullVanilla === true;
      try {
        this.applyWheelPositions(model.wheelPositions || loaded.wheelPositions || DEFAULT_WHEELS);
      } catch (err) {
        log.warn(`invalid wheel positions for ${model.name}:`, err?.message ?? err);
      }
      this.activeCar = { name: model.name, url: model.url, hullVanilla, hullHash: loaded.hullHash, collisionSource: loaded.collisionSource, legacy: loaded.legacy === true };
      this.touchingPhysics = !hullVanilla;
      this.physicsReason = hullVanilla ? undefined : `${model.name} has a non-vanilla collision model`;
      if (!hullVanilla) log.warn(`"${model.name}" changes the car's collision model; PolyModLoader now reports modified physics`);
      if (persist) {
        try {
          localStorage.setItem(STORAGE_CAR, model.url);
          localStorage.setItem(STORAGE_SOUND, model.sound || GAME.defaultSound);
        } catch {
          /* storage unavailable */
        }
      }
      this.applySound(model.sound || GAME.defaultSound);
      log.info(`active car: ${model.name}${loaded.legacy ? " (0.5 model)" : ""}${hullVanilla ? "" : " (non-vanilla collision model)"}`);
      return this.activeCar;
    })();
    this.loading = run;
    return run.finally(() => {
      if (this.loading === run) this.loading = null;
    });
  }

  // ----------------------------------------------------------------------------------- Garage UI

  installGarageHook() {
    const ui = document.getElementById("ui");
    if (!ui) {
      log.warn("UI container not found; the Select Car button is unavailable");
      return;
    }
    if (!document.getElementById("carswitcher-style")) {
      const style = document.createElement("style");
      style.id = "carswitcher-style";
      style.textContent = ".carswitcher-panel[hidden] { display: none !important; }";
      document.head.appendChild(style);
    }
    const scan = () => {
      for (const root of ui.querySelectorAll(".customization-ui")) {
        try {
          this.ensureGarageUi(root);
        } catch (err) {
          log.warn("could not add the Select Car button:", err?.message ?? err);
        }
      }
    };
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList.contains("customization-ui") || node.closest(".customization-ui") || node.querySelector(".customization-ui")) return scan();
        }
      }
    });
    this.observer.observe(ui, { childList: true, subtree: true });
    scan();
  }

  ensureGarageUi(root) {
    const bar = root.querySelector(":scope > .top");
    if (!bar || !bar.querySelector("button")) return;
    if (bar.querySelector(".carswitcher-button")) return;

    const button = document.createElement("button");
    button.className = "button carswitcher-button";
    button.innerHTML = '<img class="button-icon" src="images/test.svg"> ';
    button.append(document.createTextNode("Select Car"));
    bar.insertBefore(button, bar.querySelector(".button.right"));

    const panel = this.buildPanel();
    root.appendChild(panel);
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) this.refreshPanel(panel);
    });
  }

  buildPanel() {
    const panel = document.createElement("div");
    panel.className = "carswitcher-panel";
    panel.hidden = true;
    Object.assign(panel.style, {
      position: "absolute",
      top: "5rem",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(90%, 64rem)",
      maxHeight: "calc(100% - 7rem)",
      overflowY: "auto",
      zIndex: "1000",
      boxSizing: "border-box",
      padding: "1rem",
      display: "flex",
      flexWrap: "wrap",
      gap: "0.5rem",
      justifyContent: "center",
      backgroundColor: "var(--surface-color, rgba(0, 0, 0, 0.85))",
    });
    const list = document.createElement("div");
    list.className = "carswitcher-list";
    Object.assign(list.style, { display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", width: "100%" });
    const status = document.createElement("div");
    status.className = "carswitcher-status";
    Object.assign(status.style, { width: "100%", textAlign: "center", color: "white", fontFamily: "inherit", minHeight: "1.5em" });
    panel.append(list, status);
    this.refreshPanel(panel);
    return panel;
  }

  refreshPanel(panel) {
    const list = panel.querySelector(".carswitcher-list");
    const status = panel.querySelector(".carswitcher-status");
    list.replaceChildren();
    for (const model of this.carModels) {
      const button = document.createElement("button");
      button.className = "button carswitcher-car";
      button.dataset.url = model.url;
      const active = this.activeCar ? this.activeCar.url === model.url : model.url === GAME.defaultModel;
      button.textContent = active ? `▶ ${model.name}` : model.name;
      if (active) button.classList.add("carswitcher-active");
      button.addEventListener("click", async () => {
        if (this.loading) return;
        status.textContent = `Loading ${model.name}…`;
        try {
          const result = await this.applyCar(model);
          status.textContent = result.hullVanilla
            ? `${model.name} is ready. It is used from your next race; re-open the Garage to preview it.`
            : `${model.name} is ready. Note: it changes the car's collision shape, so PolyModLoader reports modified physics (ranked play needs a car with the original shape).`;
        } catch (err) {
          status.textContent = `Could not load ${model.name}: ${err?.message ?? err}`;
          log.warn(`could not load ${model.name} (${model.url}):`, err);
        }
        this.refreshPanel(panel);
      });
      list.appendChild(button);
    }
    if (!status.textContent && this.activeCar) status.textContent = `Current car: ${this.activeCar.name}`;
  }
}

export const polyMod = new CarSwitcherMod();
