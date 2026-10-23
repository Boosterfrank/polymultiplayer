import { log } from "./util.js";

/**
 * Access to PolyTrack 0.6.3 internals the cup needs beyond the multiplayer-connection interface:
 * the in-game state's private fields (car, spectator camera, renderer, remote cars, input, settings,
 * timer HUD, leaderboard-upload flag) and two private routines that gate the controls and the
 * restart. Everything is looked up once with PML's `getFromPolyTrack`, which evaluates in the game
 * bundle's scope; the minified names were checked against the 0.6.3 build. If anything is missing the
 * cup runs without live-round hooks (and says so).
 */
const API_SOURCE = `({
  Game: Is,
  KeyBinding: ge.A,
  Time: xt.A,
  formatTime: (time) => He.A.formatTimeString(time),
  keyLabel: (code) => ve(code),
  read: (g) => {
    const session = Za.get(g);
    const track = Ta.get(g);
    return {
      connection: session?.multiplayerConnection ?? null,
      sessionId: session?.sessionId ?? null,
      gameMode: session?.gameMode ?? null,
      car: Xa.get(g),
      spectator: fs.get(g),
      ended: !!ss.get(g),
      hud: _a.get(g),
      renderer: la.get(g),
      remoteCars: as.get(g),
      checkpointCount: ra.get(g)?.getTotalNumberOfCheckpointIndices?.() ?? 0,
      trackId: track?.getId?.() ?? null,
    };
  },
  hudDefaultVisible: (g) => Ma.get(g) !== false,
  input: (g) => qa.get(g),
  settings: (g) => ua.get(g),
  timer: (g) => za.get(g),
  remoteVolume: (g) => vs.get(g) ?? 0.35,
  getUploads: (g) => !!ya.get(g),
  setUploads: (g, enabled) => { ya.set(g, !!enabled); },
  reset: (g) => { hs.set(g, null); Ts.call(g); Ms.call(g); },
  guardControls: (fn) => { const original = bs; bs = function () { return fn(this) || original.call(this); }; },
  guardRestart: (fn) => { const original = Ss; Ss = function () { if (!fn(this)) return original.call(this); }; },
  carThumbnail: (style) => kr.F(style, new Sr.A()),
  store: (g) => da.get(g),
  profiles: (g) => ha.get(g),
})`;

const REQUIRED = ["Game", "KeyBinding", "Time", "read", "reset", "guardControls", "guardRestart", "settings", "input", "timer"];

/** @returns {object|null} the native API, or null when the game build is not the expected one */
export function connectGame(pml) {
  let api;
  try {
    api = pml.getFromPolyTrack(API_SOURCE);
  } catch (err) {
    log.error("could not reach the game internals the cup needs", err);
    return null;
  }
  const missing = REQUIRED.filter((k) => !api || api[k] == null);
  if (missing.length) {
    log.error("unexpected game internals for the cup: " + missing.join(", "));
    return null;
  }
  if (typeof api.Game?.prototype?.update !== "function") {
    log.error("the in-game state has no update method; cup hooks disabled");
    return null;
  }

  /** Camera back to the own car (after spectating). */
  api.release = (g, cockpit = false) => {
    const info = api.read(g);
    if (!info.car || !info.renderer) return;
    if (info.spectator) info.spectator.isEnabled = false;
    info.renderer.setCamera(cockpit ? info.car.cameraCockpit : info.car.cameraOrbit);
    info.car.audioVolume = 1;
    info.car.setVisible?.(true);
    const volume = api.remoteVolume(g);
    for (const entry of info.remoteCars?.values() ?? []) entry.car.audioVolume = volume;
  };

  /** Chase camera of a remote car: its own orbit camera, which the game only updates for the local car. */
  api.follow = (g, slot, dt) => {
    const info = api.read(g);
    const entry = info.remoteCars?.get(slot);
    if (!entry?.car || !info.renderer) return false;
    try {
      entry.car.updateCameras(Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60);
    } catch {
      /* the camera keeps its last pose */
    }
    if (info.spectator?.isEnabled) info.spectator.isEnabled = false;
    info.renderer.setCamera(entry.car.cameraOrbit);
    if (info.car) {
      info.car.audioVolume = 0;
      info.car.setVisible?.(false);
    }
    for (const [peer, other] of info.remoteCars) {
      other.car.audioVolume = peer === slot ? 1 : 0.15;
      if (peer === slot) {
        other.car.setVisible?.(true);
        other.car.setOpacity?.(1);
      }
    }
    return true;
  };

  /** The game's own free camera, starting from the current view, with the HUD kept visible. */
  api.enterFreecam = (g) => {
    const info = api.read(g);
    const spectator = info.spectator;
    if (!spectator || !info.renderer) return;
    const camera = info.renderer.camera;
    if (camera && camera !== spectator.camera) {
      spectator.camera.position.copy(camera.position);
      spectator.camera.quaternion.copy(camera.quaternion);
      if (typeof camera.fov === "number") {
        spectator.camera.fov = camera.fov;
        spectator.camera.updateProjectionMatrix?.();
      }
    }
    spectator.isEnabled = true;
    info.renderer.setCamera(spectator.camera);
    if (info.hud) info.hud.isVisible = api.hudDefaultVisible(g);
  };

  api.drivingCockpit = (g) => {
    const info = api.read(g);
    return !!info.car && !info.spectator?.isEnabled && info.renderer?.camera === info.car.cameraCockpit;
  };

  /** Show a round time (car time plus the time of earlier attempts) in the game's timer. */
  api.showRoundTime = (g, frames) => {
    const timer = api.timer(g);
    const time = new api.Time(frames);
    timer?.update?.({ getTime: () => time, getFinishTime: () => null });
  };
  api.showRoundCheckpoint = (g, frames) => api.timer(g)?.showCheckpointTime?.(new api.Time(frames), null);
  api.showRoundFinish = (g, frames) => {
    const banner = api.read(g).hud?.element?.querySelector?.(".time-announcer-ui");
    const time = banner?.querySelector(".current .time");
    if (time) time.textContent = api.formatTime(new api.Time(frames));
    banner?.querySelectorAll(".record,.difference").forEach((node) => node.classList.add("hidden"));
  };

  return api;
}

/**
 * Wrap the in-game state's update/dispose and the control/restart gates.
 * @param {object} native connectGame() result
 * @param {{onGameUpdate(game, dt): boolean, beforeRender(game, dt): void, onGameDisposed(game): void, shouldBlockControls(game): boolean, handleRestart(game): boolean}} handlers
 */
export function installGameHooks(native, handlers) {
  const proto = native.Game.prototype;
  if (proto.__polyRankedHooked) return;
  proto.__polyRankedHooked = true;
  const update = proto.update;
  proto.update = function (...args) {
    let active = false;
    try {
      active = handlers.onGameUpdate(this, args[0]) === true;
    } catch (err) {
      log.error("cup game hook failed", err);
    }
    if (!active) return update.apply(this, args);
    const renderer = native.read(this).renderer;
    if (!renderer || typeof renderer.update !== "function") return update.apply(this, args);
    const game = this;
    const descriptor = Object.getOwnPropertyDescriptor(renderer, "update");
    const original = renderer.update;
    // Visibility and the spectator camera are applied after the native car updates, right before the draw.
    renderer.update = function (...renderArgs) {
      try {
        handlers.beforeRender(game, args[0]);
      } catch (err) {
        log.error("cup render hook failed", err);
      }
      return original.apply(this, renderArgs);
    };
    try {
      return update.apply(this, args);
    } finally {
      if (descriptor) Object.defineProperty(renderer, "update", descriptor);
      else delete renderer.update;
    }
  };
  const dispose = proto.dispose;
  proto.dispose = function (...args) {
    try {
      handlers.onGameDisposed(this);
    } catch (err) {
      log.error("cup dispose hook failed", err);
    }
    return dispose.apply(this, args);
  };
  native.guardControls((game) => {
    try {
      return handlers.shouldBlockControls(game) === true;
    } catch {
      return false;
    }
  });
  native.guardRestart((game) => {
    try {
      return handlers.handleRestart(game) === true;
    } catch {
      return false;
    }
  });
}
