import { log } from "./util.js";

export const BRIDGE_KEY = "__polyRankedBridge";
export const BRIDGE_EVENT = "polyranked:bridge";

/** PML's own code inserts this exact statement at the end of the game's init function. */
const ANCHOR_TOKEN = "ActivePolyModLoader.postInitMods();";

/**
 * JavaScript inserted into the game's init function (PolyTrack 0.6.3 bundle), right after
 * PML's `postInitMods()` call, where the init function's locals are still in scope:
 *   $ = current game state, J = start game, K = back to main menu, S = user profiles,
 *   T = API client, R = popup manager, k = language, x = track registry, r = settings,
 *   l = audio manager, o = state transition trigger, I = platform SDK.
 */
const BRIDGE_CODE = `
try {
  window.${BRIDGE_KEY} = {
    version: 1,
    getState: function () { return $; },
    setState: function (s) { $ = s; },
    startGame: J,
    backToMenu: K,
    profiles: S,
    api: T,
    popups: R,
    language: k,
    trackRegistry: x,
    settings: r,
    audio: l,
    trigger: o,
    platform: I,
    getStateClasses: function () { return { InGame: Is, MainMenu: bd }; },
  };
  window.dispatchEvent(new CustomEvent("${BRIDGE_EVENT}"));
} catch (polyRankedErr) {
  console.error("[PolyRanked] bridge capture failed", polyRankedErr);
}
`;

/**
 * Register the global mixin that captures the bridge. Must be called from `preInit`.
 * @returns {boolean} whether the mixin was registered
 */
export function installBridgeMixin(pml) {
  try {
    pml.registerGlobalMixin({ type: 3 /* MixinType.INSERT */, token: ANCHOR_TOKEN, func: BRIDGE_CODE });
    return true;
  } catch (err) {
    log.error("could not install the game bridge mixin (unsupported PolyModLoader version?)", err);
    return false;
  }
}

export function getBridge() {
  return globalThis[BRIDGE_KEY] ?? null;
}

/** Resolve once the game init function has published the bridge. */
export function waitForBridge(timeoutMs = 120000) {
  const existing = getBridge();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener(BRIDGE_EVENT, onReady);
      reject(new Error("timed out waiting for the game bridge"));
    }, timeoutMs);
    function onReady() {
      clearTimeout(timer);
      window.removeEventListener(BRIDGE_EVENT, onReady);
      resolve(getBridge());
    }
    window.addEventListener(BRIDGE_EVENT, onReady);
  });
}

/** Sanity-check that the captured locals look like what we expect from PolyTrack 0.6.3. */
export function validateBridge(bridge) {
  const problems = [];
  if (!bridge) return ["bridge missing"];
  if (typeof bridge.startGame !== "function" || bridge.startGame.length !== 6) problems.push("startGame");
  if (typeof bridge.backToMenu !== "function") problems.push("backToMenu");
  if (typeof bridge.profiles?.getCurrentUserProfile !== "function") problems.push("profiles");
  if (typeof bridge.popups?.showNoButtons !== "function" || typeof bridge.popups?.hide !== "function") problems.push("popups");
  if (typeof bridge.trackRegistry?.forEachOfficialTrack !== "function") problems.push("trackRegistry");
  if (typeof bridge.getState !== "function") problems.push("getState");
  return problems;
}

/**
 * Look up game internals by their (minified) module-scope names. Everything is optional;
 * callers fall back to self-contained implementations when a lookup fails.
 */
export function lookupGame(pml) {
  const get = (path) => {
    try {
      return pml.getFromPolyTrack(path) ?? null;
    } catch {
      return null;
    }
  };
  const gameMode = get("an");
  return {
    InGameState: get("Is"),
    MainMenuState: get("bd"),
    GameMode: gameMode,
    competitiveMode: typeof gameMode?.Competitive === "number" ? gameMode.Competitive : 1,
    TrackCodec: get("Ul.A"),
    CarStyle: get("Zt.A"),
    CarStateCodec: get("$t"),
    TimeFormat: get("He.A"),
    Determinism: get("Mo"),
  };
}

/**
 * Result of the game's physics determinism self-test (PolyTrack enum: Uninitialized=0, Ok=1,
 * TestFailed=2, AssetsFailed=3). The test runs asynchronously during startup.
 * @returns {"ok"|"pending"|"failed"|"unknown"}
 */
export function physicsDeterminism(bridge, game) {
  const state = bridge?.api?.determinismState;
  if (state == null) return "unknown";
  const e = game?.Determinism ?? {};
  const ok = e.Ok ?? 1;
  const uninitialized = e.Uninitialized ?? 0;
  if (state === ok) return "ok";
  if (state === uninitialized) return "pending";
  return "failed";
}

/** True unless the self-test explicitly failed (a pending test is not held against the player). */
export function physicsDeterministic(bridge, game) {
  return physicsDeterminism(bridge, game) !== "failed";
}
