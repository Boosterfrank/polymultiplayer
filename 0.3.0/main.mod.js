// PolyRanked 0.3.0 – https://github.com/boosterfrank/polymultiplayer (built 2026-10-23)

// mod/src/main.js
import { PolyMod } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";

// shared/protocol.js
var PROTOCOL_VERSION = 1;
var MSG = Object.freeze({
  // client -> server
  HELLO: "hello",
  QUEUE_JOIN: "queue_join",
  QUEUE_LEAVE: "queue_leave",
  MATCH_READY: "match_ready",
  RECORD: "record",
  CAR_RESET: "car_reset",
  LEAVE_MATCH: "leave_match",
  PING: "ping",
  LEADERBOARD_GET: "leaderboard_get",
  CUP_JOIN: "cup_join",
  CUP_LEAVE: "cup_leave",
  CUP_ROUND_READY: "cup_round_ready",
  // the in-game state for a cup session exists {sessionId, pb}
  CUP_WARMUP_READY: "cup_warmup_ready",
  // done practising {sessionId}
  CUP_CHECKPOINT: "cup_checkpoint",
  // live-round progress {sessionId, index, frames}
  CUP_DNF: "cup_dnf",
  // retire from the live round {sessionId}
  // server -> client
  WELCOME: "welcome",
  ERROR: "error",
  QUEUE_STATUS: "queue_status",
  MATCH_FOUND: "match_found",
  MATCH_RESUME: "match_resume",
  ROUND_START: "round_start",
  ROUND_CLOCK: "round_clock",
  RECORDS: "records",
  ROUND_END: "round_end",
  MATCH_END: "match_end",
  PLAYER_LEFT: "player_left",
  PLAYER_STATUS: "player_status",
  PINGS: "pings",
  SERVER_MESSAGE: "server_message",
  PONG: "pong",
  LEADERBOARD: "leaderboard",
  PROFILE: "profile",
  CUP_STATE: "cup_state",
  CUP_END: "cup_end"
});
var BIN = Object.freeze({
  CAR_UPDATE: 1,
  // client -> server
  CAR_UPDATE_RELAY: 2
  // server -> client (prefixed with the sender slot)
});
var MAX_STATES_PER_BATCH = 64;
var MAX_STATE_BYTES = 512;
var HEADER_BATCH = 1 + 4 + 4 + 2;
function encodeCarBatch(sessionId, resetCounter, states) {
  if (states.length > MAX_STATES_PER_BATCH) {
    throw new Error("Too many car states in one batch");
  }
  let total = HEADER_BATCH;
  for (const s of states) total += 2 + s.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = BIN.CAR_UPDATE;
  dv.setUint32(1, sessionId >>> 0, true);
  dv.setUint32(5, resetCounter >>> 0, true);
  dv.setUint16(9, states.length, true);
  let o = HEADER_BATCH;
  for (const s of states) {
    dv.setUint16(o, s.length, true);
    o += 2;
    out.set(s, o);
    o += s.length;
  }
  return out;
}
function readStates(bytes, dv, offset, count) {
  const states = [];
  let o = offset;
  for (let i = 0; i < count; i++) {
    if (o + 2 > bytes.length) throw new Error("Truncated car batch");
    const len = dv.getUint16(o, true);
    o += 2;
    if (len === 0 || len > MAX_STATE_BYTES || o + len > bytes.length) {
      throw new Error("Invalid car state length");
    }
    states.push(bytes.subarray(o, o + len));
    o += len;
  }
  if (o !== bytes.length) throw new Error("Leftover data in car batch");
  return states;
}
function decodeCarRelay(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < HEADER_BATCH + 1 || bytes[0] !== BIN.CAR_UPDATE_RELAY) {
    throw new Error("Not a car relay frame");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slot = bytes[1];
  const sessionId = dv.getUint32(2, true);
  const resetCounter = dv.getUint32(6, true);
  const count = dv.getUint16(10, true);
  if (count > MAX_STATES_PER_BATCH) throw new Error("Too many car states");
  return { slot, sessionId, resetCounter, states: readStates(bytes, dv, HEADER_BATCH + 1, count) };
}
function formatFrames(frames) {
  if (frames == null) return "---";
  const n = Math.abs(frames);
  const minutes = Math.floor(n / 6e4);
  const seconds = Math.floor((n - minutes * 6e4) / 1e3);
  const millis = n - minutes * 6e4 - seconds * 1e3;
  return (frames < 0 ? "-" : "") + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
}

// mod/src/config.js
var DEFAULT_SERVER_URL = true ? "wss://hydrogen-granted-distributors-pos.trycloudflare.com" : "wss://hydrogen-granted-distributors-pos.trycloudflare.com";
var LEGACY_DEFAULT_SERVER_URL = "ws://localhost:8788";
var SHOW_MENU_BUTTON = false;
var MOD_VERSION = true ? "0.3.0" : "0.0.0-dev";
var MOD_ID = "polyranked";
var MOD_NAME = "PolyRanked";
var GAME_VERSION = "0.6.3";
var CAR_FLUSH_MS = 100;
var GAME_MODE_COMPETITIVE = 1;

// mod/src/util.js
var LOG_PREFIX = "[PolyRanked]";
var log = {
  info: (...a) => console.log(LOG_PREFIX, ...a),
  warn: (...a) => console.warn(LOG_PREFIX, ...a),
  error: (...a) => console.error(LOG_PREFIX, ...a)
};
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text != null) node.textContent = props.text;
  if (props.html != null) node.innerHTML = props.html;
  if (props.style) Object.assign(node.style, props.style);
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) if (v != null) node.setAttribute(k, String(v));
  }
  if (props.on) for (const [k, v] of Object.entries(props.on)) node.addEventListener(k, v);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  for (const child of children) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
var Emitter = class {
  constructor() {
    this._target = new EventTarget();
  }
  on(type, handler) {
    const wrapped = (ev) => handler(ev.detail);
    this._target.addEventListener(type, wrapped);
    return () => this._target.removeEventListener(type, wrapped);
  }
  once(type, handler) {
    const off = this.on(type, (detail) => {
      off();
      handler(detail);
    });
    return off;
  }
  emit(type, detail) {
    this._target.dispatchEvent(new CustomEvent(type, { detail }));
  }
};
function safe(fn, label = "callback") {
  try {
    return fn();
  } catch (err) {
    log.error(`${label} failed`, err);
    return void 0;
  }
}

// mod/src/bridge.js
var BRIDGE_KEY = "__polyRankedBridge";
var BRIDGE_EVENT = "polyranked:bridge";
var ANCHOR_TOKEN = "ActivePolyModLoader.postInitMods();";
var BRIDGE_CODE = `
try {
  window.${BRIDGE_KEY} = {
    version: 1,
    getState: function () { return $; },
    setState: function (s) { $ = s; },
    startGame: J,
    backToMenu: K,
    openGarage: q,
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
function installBridgeMixin(pml) {
  try {
    pml.registerGlobalMixin({ type: 3, token: ANCHOR_TOKEN, func: BRIDGE_CODE });
    return true;
  } catch (err) {
    log.error("could not install the game bridge mixin (unsupported PolyModLoader version?)", err);
    return false;
  }
}
function getBridge() {
  return globalThis[BRIDGE_KEY] ?? null;
}
function waitForBridge(timeoutMs = 12e4) {
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
function validateBridge(bridge) {
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
function lookupGame(pml) {
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
    Determinism: get("Mo")
  };
}
function physicsDeterminism(bridge, game) {
  const state = bridge?.api?.determinismState;
  if (state == null) return "unknown";
  const e = game?.Determinism ?? {};
  const ok = e.Ok ?? 1;
  const uninitialized = e.Uninitialized ?? 0;
  if (state === ok) return "ok";
  if (state === uninitialized) return "pending";
  return "failed";
}
function physicsDeterministic(bridge, game) {
  return physicsDeterminism(bridge, game) !== "failed";
}

// mod/src/game.js
var API_SOURCE = `({
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
var REQUIRED = ["Game", "KeyBinding", "Time", "read", "reset", "guardControls", "guardRestart", "settings", "input", "timer"];
function connectGame(pml) {
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
  api.follow = (g, slot, dt) => {
    const info = api.read(g);
    const entry = info.remoteCars?.get(slot);
    if (!entry?.car || !info.renderer) return false;
    try {
      entry.car.updateCameras(Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60);
    } catch {
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
function installGameHooks(native, handlers) {
  const proto = native.Game.prototype;
  if (proto.__polyRankedHooked) return;
  proto.__polyRankedHooked = true;
  const update = proto.update;
  proto.update = function(...args) {
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
    renderer.update = function(...renderArgs) {
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
  proto.dispose = function(...args) {
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

// mod/src/client.js
var PING_INTERVAL_MS = 5e3;
var RECONNECT_MIN_MS = 1e3;
var RECONNECT_MAX_MS = 15e3;
var RankedClient = class extends Emitter {
  /**
   * @param {object} opts
   * @param {() => string} opts.url
   * @param {() => string} opts.secret
   * @param {() => {nickname:string, countryCode:string|null, carStyle:string|null}} opts.profile
   * @param {() => boolean} opts.vanilla
   * @param {string} opts.gameVersion
   * @param {string} opts.modVersion
   * @param {typeof WebSocket} [opts.WebSocketImpl]
   */
  constructor(opts) {
    super();
    this.opts = opts;
    this.WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket;
    this.ws = null;
    this.state = "disconnected";
    this.welcome = null;
    this.playerId = null;
    this.rtt = null;
    this.clockOffset = 0;
    this.autoReconnect = false;
    this._reconnectDelay = RECONNECT_MIN_MS;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._pendingPings = /* @__PURE__ */ new Map();
    this.lastError = null;
  }
  get connected() {
    return this.state === "connected" || this.state === "ready";
  }
  get ready() {
    return this.state === "ready";
  }
  serverNow() {
    return Date.now() + this.clockOffset;
  }
  setState(state, detail = null) {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", { state, detail });
  }
  connect() {
    this.autoReconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const url = this.opts.url();
    this.lastError = null;
    this.setState("connecting", url);
    let ws;
    try {
      ws = new this.WebSocketImpl(url);
    } catch (err) {
      this.lastError = `Invalid server URL: ${url}`;
      this.setState("disconnected", this.lastError);
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this._reconnectDelay = RECONNECT_MIN_MS;
      this.setState("connected");
      this.sendHello();
      this.startPings();
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      this.onMessage(ev.data);
    });
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPings();
      this.welcome = null;
      if (ev.code === 4001) {
        this.autoReconnect = false;
        this.lastError = "Signed in from another tab or window";
      } else if (ev.code === 1008) {
        this.autoReconnect = false;
        this.lastError = this.lastError ?? "Server rejected the connection";
      }
      this.setState("disconnected", this.lastError ?? `Connection closed (${ev.code})`);
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      if (this.ws !== ws) return;
      this.lastError = `Could not reach ${url}`;
    });
  }
  disconnect() {
    this.autoReconnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.stopPings();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1e3, "bye");
      } catch {
      }
    }
    this.welcome = null;
    this.setState("disconnected", null);
  }
  scheduleReconnect() {
    if (!this.autoReconnect || this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(RECONNECT_MAX_MS, Math.round(this._reconnectDelay * 1.7));
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.autoReconnect) this.connect();
    }, delay);
  }
  sendHello() {
    const profile = this.opts.profile();
    this.send({
      type: MSG.HELLO,
      protocol: PROTOCOL_VERSION,
      secret: this.opts.secret(),
      nickname: profile.nickname,
      countryCode: profile.countryCode,
      carStyle: profile.carStyle,
      gameVersion: this.opts.gameVersion,
      modVersion: this.opts.modVersion,
      vanilla: this.opts.vanilla()
    });
  }
  startPings() {
    this.stopPings();
    const ping = () => {
      if (!this.connected) return;
      const t = Date.now();
      this._pendingPings.set(t, t);
      if (this._pendingPings.size > 10) this._pendingPings.delete(this._pendingPings.keys().next().value);
      this.send({ type: MSG.PING, t });
    };
    ping();
    this._pingTimer = setInterval(ping, PING_INTERVAL_MS);
  }
  stopPings() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    this._pendingPings.clear();
  }
  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
  sendBinary(bytes) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(bytes);
    return true;
  }
  onMessage(data) {
    if (typeof data !== "string") {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
      if (bytes) this.emit("binary", bytes);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      log.warn("bad JSON from server");
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case MSG.PONG: {
        const sent = this._pendingPings.get(msg.t);
        if (sent != null) {
          this._pendingPings.delete(msg.t);
          const now = Date.now();
          this.rtt = now - sent;
          if (typeof msg.serverTime === "number") this.clockOffset = msg.serverTime - (now - this.rtt / 2);
        }
        break;
      }
      case MSG.WELCOME:
        this.welcome = msg;
        this.playerId = msg.playerId;
        if (typeof msg.serverTime === "number" && this.rtt == null) this.clockOffset = msg.serverTime - Date.now();
        this.setState("ready");
        break;
      case MSG.ERROR:
        this.lastError = msg.message;
        this.emit("error", msg);
        break;
      default:
        break;
    }
    this.emit(msg.type, msg);
    this.emit("message", msg);
  }
};

// mod/src/identity.js
var KEY_SECRET = "polyranked.secret";
var KEY_SETTINGS = "polyranked.settings";
var DEFAULT_SETTINGS = Object.freeze({
  serverUrl: DEFAULT_SERVER_URL,
  nameOverride: "",
  autoConnect: true,
  showHud: true
});
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
function getSecret() {
  const s = storage();
  let secret = s?.getItem(KEY_SECRET);
  if (!secret || secret.length < 32) {
    secret = randomHex(32);
    s?.setItem(KEY_SECRET, secret);
  }
  return secret;
}
function loadSettings() {
  const s = storage();
  try {
    const raw = s?.getItem(KEY_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    const settings = { ...DEFAULT_SETTINGS, ...parsed };
    if (!settings.serverUrl || settings.serverUrl === LEGACY_DEFAULT_SERVER_URL) settings.serverUrl = DEFAULT_SERVER_URL;
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(settings) {
  const s = storage();
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  s?.setItem(KEY_SETTINGS, JSON.stringify(merged));
  return merged;
}
function normalizeServerUrl(input) {
  let url = String(input ?? "").trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, "ws");
  if (!/^wss?:\/\//i.test(url)) url = (url.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(url) ? "ws://" : "wss://") + url;
  return url.replace(/\/+$/, "");
}

// mod/src/carstate.js
function encodeCarState(e) {
  let t = 0;
  t += 3;
  t += 4;
  t += 1;
  if (e.finishFrames != null) t += 3;
  t += 2;
  t += 12;
  t += 16;
  t += 1 + 4 * e.collisionImpulses.length;
  for (const c of e.wheelContact) if (c != null) t += 24;
  t += 16 * 4;
  t += 4;
  t += 1;
  const out = new Uint8Array(t);
  const dv = new DataView(out.buffer);
  let n = 0;
  out[n] = e.frames & 255;
  out[n + 1] = e.frames >> 8 & 255;
  out[n + 2] = e.frames >> 16 & 255;
  n += 3;
  dv.setFloat32(n, e.speedKmh, true);
  n += 4;
  out[n] = (e.hasStarted ? 1 : 0) | (e.finishFrames != null ? 1 : 0) << 1 | (e.hasCheckpointToRespawnAt ? 1 : 0) << 2 | (e.wheelContact[0] != null ? 1 : 0) << 3 | (e.wheelContact[1] != null ? 1 : 0) << 4 | (e.wheelContact[2] != null ? 1 : 0) << 5 | (e.wheelContact[3] != null ? 1 : 0) << 6;
  n += 1;
  if (e.finishFrames != null) {
    out[n] = e.finishFrames & 255;
    out[n + 1] = e.finishFrames >> 8 & 255;
    out[n + 2] = e.finishFrames >> 16 & 255;
    n += 3;
  }
  dv.setUint16(n, e.nextCheckpointIndex, true);
  n += 2;
  dv.setFloat32(n, e.position.x, true);
  dv.setFloat32(n + 4, e.position.y, true);
  dv.setFloat32(n + 8, e.position.z, true);
  n += 12;
  dv.setFloat32(n, e.quaternion.x, true);
  dv.setFloat32(n + 4, e.quaternion.y, true);
  dv.setFloat32(n + 8, e.quaternion.z, true);
  dv.setFloat32(n + 12, e.quaternion.w, true);
  n += 16;
  out[n] = e.collisionImpulses.length & 255;
  n += 1;
  for (const v of e.collisionImpulses) {
    dv.setFloat32(n, v, true);
    n += 4;
  }
  for (const c of e.wheelContact) {
    if (c == null) continue;
    dv.setFloat32(n, c.position.x, true);
    dv.setFloat32(n + 4, c.position.y, true);
    dv.setFloat32(n + 8, c.position.z, true);
    dv.setFloat32(n + 12, c.normal.x, true);
    dv.setFloat32(n + 16, c.normal.y, true);
    dv.setFloat32(n + 20, c.normal.z, true);
    n += 24;
  }
  for (const arr of [e.wheelSuspensionLength, e.wheelSuspensionVelocity, e.wheelDeltaRotation, e.wheelSkidInfo]) {
    for (let i = 0; i < 4; i++) {
      dv.setFloat32(n, arr[i] ?? 0, true);
      n += 4;
    }
  }
  dv.setFloat32(n, e.steering, true);
  n += 4;
  out[n] = (e.controls.up ? 1 : 0) | (e.controls.right ? 1 : 0) << 1 | (e.controls.down ? 1 : 0) << 2 | (e.controls.left ? 1 : 0) << 3 | (e.controls.reset ? 1 : 0) << 4 | (e.brakeLightEnabled ? 1 : 0) << 5;
  n += 1;
  return out;
}
function decodeCarState(bytes) {
  const short = "CarState data is too short";
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const need = (k) => {
    if (bytes.length < i + k) throw new Error(short);
  };
  need(3);
  const frames = bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16;
  i += 3;
  need(4);
  const speedKmh = dv.getFloat32(i, true);
  i += 4;
  need(1);
  const flags = bytes[i];
  const hasStarted = !!(flags & 1);
  const hasFinish = !!(flags & 2);
  const hasCheckpointToRespawnAt = !!(flags & 4);
  const contactFlags = [!!(flags & 8), !!(flags & 16), !!(flags & 32), !!(flags & 64)];
  i += 1;
  let finishFrames = null;
  if (hasFinish) {
    need(3);
    finishFrames = bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16;
    i += 3;
  }
  need(2);
  const nextCheckpointIndex = dv.getUint16(i, true);
  i += 2;
  need(12);
  const position = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
  i += 12;
  need(16);
  const quaternion = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true), w: dv.getFloat32(i + 12, true) };
  i += 16;
  need(1);
  const impulseCount = bytes[i];
  i += 1;
  if (impulseCount > 4) throw new Error("Number of collision impulses exceeds maximum allowed");
  const collisionImpulses = [];
  for (let k = 0; k < impulseCount; k++) {
    need(4);
    collisionImpulses.push(dv.getFloat32(i, true));
    i += 4;
  }
  const wheelContact = [null, null, null, null];
  for (let w = 0; w < 4; w++) {
    if (!contactFlags[w]) continue;
    need(24);
    const p = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
    i += 12;
    const nrm = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
    i += 12;
    wheelContact[w] = { position: p, normal: nrm };
  }
  const readFour = () => {
    const arr = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      need(4);
      arr[k] = dv.getFloat32(i, true);
      i += 4;
    }
    return arr;
  };
  const wheelSuspensionLength = readFour();
  const wheelSuspensionVelocity = readFour();
  const wheelDeltaRotation = readFour();
  const wheelSkidInfo = readFour();
  need(4);
  const steering = dv.getFloat32(i, true);
  i += 4;
  need(1);
  const c = bytes[i];
  const controls = { up: !!(c & 1), right: !!(c & 2), down: !!(c & 4), left: !!(c & 8), reset: !!(c & 16) };
  const brakeLightEnabled = !!(c & 32);
  i += 1;
  return {
    numberOfBytes: i,
    carState: {
      frames,
      speedKmh,
      hasStarted,
      finishFrames,
      nextCheckpointIndex,
      hasCheckpointToRespawnAt,
      position,
      quaternion,
      collisionImpulses,
      wheelContact,
      wheelSuspensionLength,
      wheelSuspensionVelocity,
      wheelDeltaRotation,
      wheelSkidInfo,
      steering,
      brakeLightEnabled,
      controls
    }
  };
}
function normalizeQuaternion(q) {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
  } else {
    q.x /= len;
    q.y /= len;
    q.z /= len;
    q.w /= len;
  }
  return q;
}

// mod/src/connection.js
var FrameTime = class _FrameTime {
  constructor(frames = 0) {
    this._frames = frames;
  }
  get numberOfFrames() {
    return this._frames;
  }
  get time() {
    return this._frames / 1e3;
  }
  clone() {
    return new _FrameTime(this._frames);
  }
  difference(other) {
    return new _FrameTime(this._frames - other.numberOfFrames);
  }
  lessThan(other) {
    return this._frames < other.numberOfFrames;
  }
  greaterThan(other) {
    return this._frames > other.numberOfFrames;
  }
  lessOrEqual(other) {
    return this._frames <= other.numberOfFrames;
  }
  greaterOrEqual(other) {
    return this._frames >= other.numberOfFrames;
  }
  equals(other) {
    return this._frames === other.numberOfFrames;
  }
  isNegative() {
    return this._frames < 0;
  }
};
var RankedConnection = class {
  /**
   * @param {object} opts
   * @param {{send(obj):void, sendBinary(bytes):void}} opts.client
   * @param {number} opts.matchSlot our slot
   * @param {Array<{slot:number, nickname:string, countryCode:string|null, carStyle:any, team:number|null}>} opts.players
   * @param {(frames:number)=>object} [opts.makeTime] factory for record objects
   * @param {object|null} [opts.carStyleCodec] class with static deserializeSafe(str)
   * @param {() => void} [opts.onDispose]
   * @param {(sessionId:number) => void} [opts.onAttached] the game created its in-game state for this session
   * @param {number} [opts.flushIntervalMs]
   * @param {number} [opts.gameMode]
   * @param {(frames:number) => number} [opts.transformRecord] adjust a finish time before it is reported (cup rounds add the time spent before a restart)
   */
  constructor(opts) {
    this.client = opts.client;
    this.matchSlot = opts.matchSlot;
    this.makeTime = opts.makeTime ?? ((frames) => new FrameTime(frames));
    this.carStyleCodec = opts.carStyleCodec ?? null;
    this.onDispose = opts.onDispose ?? (() => {
    });
    this.onAttached = opts.onAttached ?? (() => {
    });
    this.gameMode = opts.gameMode ?? GAME_MODE_COMPETITIVE;
    this.transformRecord = opts.transformRecord ?? null;
    this.flushIntervalMs = opts.flushIntervalMs ?? CAR_FLUSH_MS;
    this.players = /* @__PURE__ */ new Map();
    for (const p of opts.players ?? []) this.upsertPlayer(p);
    this.pings = /* @__PURE__ */ new Map();
    this.sessionId = null;
    this.sessionEnded = false;
    this.track = null;
    this.disposed = false;
    this.lost = null;
    this.cb = {
      connectionLost: [],
      playersChanged: [],
      carReset: [],
      carUpdate: [],
      endSession: [],
      newSession: [],
      serverMessage: []
    };
    this.pending = { sessionId: null, resetCounter: 0, states: [] };
    this.stats = { batchesSent: 0, statesSent: 0, relaysReceived: 0, statesApplied: 0, recordsSent: 0 };
    this._flushTimer = this.flushIntervalMs > 0 ? setInterval(() => this.flush(), this.flushIntervalMs) : null;
  }
  // ----------------------------------------------------------------- players
  upsertPlayer(p) {
    const existing = this.players.get(p.slot);
    let carStyle = existing?.carStyle ?? null;
    if (p.carStyle != null && typeof p.carStyle === "object") carStyle = p.carStyle;
    else if (typeof p.carStyle === "string" && this.carStyleCodec?.deserializeSafe) carStyle = safe(() => this.carStyleCodec.deserializeSafe(p.carStyle), "carStyle");
    else if (carStyle == null && this.carStyleCodec?.deserializeSafe) carStyle = safe(() => this.carStyleCodec.deserializeSafe(""), "carStyle");
    this.players.set(p.slot, {
      id: p.slot,
      nickname: p.nickname ?? existing?.nickname ?? "Player",
      countryCode: p.countryCode ?? existing?.countryCode ?? null,
      carStyle,
      team: p.team ?? existing?.team ?? null,
      record: existing?.record ?? null,
      active: p.active ?? existing?.active ?? true,
      isSelf: p.slot === this.matchSlot
    });
  }
  setPlayers(list) {
    for (const p of list) this.upsertPlayer(p);
    for (const slot of [...this.players.keys()]) if (!list.some((p) => p.slot === slot)) this.players.delete(slot);
    this.firePlayersChanged();
  }
  removePlayer(slot) {
    const p = this.players.get(slot);
    if (!p) return;
    if (p.isSelf) return;
    this.players.delete(slot);
    this.firePlayersChanged();
  }
  /** @param {Record<number, number>} records slot -> frames */
  setRecords(records) {
    for (const p of this.players.values()) {
      const frames = records[p.id];
      p.record = frames == null ? null : this.makeTime(frames);
    }
    this.firePlayersChanged();
  }
  setPings(pings) {
    this.pings = new Map(Object.entries(pings ?? {}).map(([k, v]) => [Number(k), v]));
  }
  firePlayersChanged() {
    for (const cb of [...this.cb.playersChanged]) safe(() => cb(this.sessionId), "playersChanged");
  }
  // ----------------------------------------------------------------- game-facing interface
  getPlayers() {
    const out = [];
    for (const p of this.players.values()) {
      if (!p.active) continue;
      out.push({
        id: p.id,
        nickname: p.nickname,
        countryCode: p.countryCode,
        carStyle: p.carStyle,
        record: p.record ? p.record.clone() : null,
        isSelf: p.isSelf
      });
    }
    return out;
  }
  getMaxPlayers() {
    return Math.max(this.players.size, 2);
  }
  getPing(id) {
    if (id === this.matchSlot) return this.client.rtt ?? null;
    return this.pings.get(id) ?? null;
  }
  isInviteAllowed() {
    return false;
  }
  addConnectionLostCallback(cb) {
    if (this.lost) {
      safe(() => cb(this.lost), "connectionLost");
      return;
    }
    this.cb.connectionLost.push(cb);
  }
  removeConnectionLostCallback(cb) {
    this.cb.connectionLost = this.cb.connectionLost.filter((c) => c !== cb);
  }
  addPlayersChangedCallback(cb) {
    this.cb.playersChanged.push(cb);
  }
  removePlayersChangedCallback(cb) {
    this.cb.playersChanged = this.cb.playersChanged.filter((c) => c !== cb);
  }
  addCarResetCallback(cb) {
    this.cb.carReset.push(cb);
  }
  removeCarResetCallback(cb) {
    this.cb.carReset = this.cb.carReset.filter((c) => c !== cb);
  }
  addCarUpdateCallback(cb) {
    this.cb.carUpdate.push(cb);
  }
  removeCarUpdateCallback(cb) {
    this.cb.carUpdate = this.cb.carUpdate.filter((c) => c !== cb);
  }
  /** The game calls this from its in-game state constructor: a good moment to learn the state exists. */
  addEndSessionCallback(sessionId, cb) {
    this.cb.endSession.push(cb);
    if (sessionId !== this.sessionId || this.sessionEnded) {
      safe(() => cb(), "endSession");
    } else {
      safe(() => this.onAttached(sessionId), "onAttached");
    }
  }
  removeEndSessionCallback(cb) {
    this.cb.endSession = this.cb.endSession.filter((c) => c !== cb);
  }
  addNewSessionCallback(sessionId, cb) {
    this.cb.newSession.push(cb);
    if (sessionId != null && sessionId !== this.sessionId && this.sessionId != null && this.track) {
      safe(() => cb(this.sessionId, this.gameMode, this.track.trackMetadata, this.track.trackData), "newSession");
    }
  }
  removeNewSessionCallback(cb) {
    this.cb.newSession = this.cb.newSession.filter((c) => c !== cb);
  }
  addServerMessageCallback(cb) {
    this.cb.serverMessage.push(cb);
  }
  removeServerMessageCallback(cb) {
    this.cb.serverMessage = this.cb.serverMessage.filter((c) => c !== cb);
  }
  sendCarReset(sessionId, resetCounter) {
    if (sessionId !== this.sessionId || this.sessionEnded) return;
    this.flush();
    this.pending = { sessionId, resetCounter, states: [] };
    this.client.send({ type: MSG.CAR_RESET, sessionId, resetCounter });
  }
  sendCarUpdate(sessionId, resetCounter, carState) {
    if (sessionId !== this.sessionId || this.sessionEnded) return;
    if (this.pending.sessionId !== sessionId || this.pending.resetCounter !== resetCounter) {
      this.flush();
      this.pending = { sessionId, resetCounter, states: [] };
    }
    let bytes;
    try {
      bytes = encodeCarState(carState);
    } catch (err) {
      log.warn("could not encode car state", err);
      return;
    }
    this.pending.states.push(bytes);
    if (this.pending.states.length >= 32) this.flush();
  }
  flush() {
    const { sessionId, resetCounter, states } = this.pending;
    if (!states.length || sessionId == null) return;
    this.pending.states = [];
    this.stats.batchesSent++;
    this.stats.statesSent += states.length;
    try {
      this.client.sendBinary(encodeCarBatch(sessionId, resetCounter, states));
    } catch (err) {
      log.warn("could not send car batch", err);
    }
  }
  sendRecord(sessionId, time) {
    if (sessionId !== this.sessionId || this.sessionEnded) return;
    let frames = time?.numberOfFrames;
    if (!Number.isInteger(frames) || frames <= 0) return;
    if (this.transformRecord) frames = this.transformRecord(frames);
    if (!Number.isInteger(frames) || frames <= 0) return;
    const me = this.players.get(this.matchSlot);
    if (me && (!me.record || frames < me.record.numberOfFrames)) {
      me.record = this.makeTime(frames);
      this.firePlayersChanged();
    }
    this.stats.recordsSent++;
    this.client.send({ type: MSG.RECORD, sessionId, frames });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this._flushTimer) clearInterval(this._flushTimer);
    this._flushTimer = null;
    this.flush();
    for (const k of Object.keys(this.cb)) this.cb[k] = [];
    safe(() => this.onDispose(), "onDispose");
  }
  // ----------------------------------------------------------------- driven by the match controller
  /**
   * A new round: tell the game to (re)start on the track (its new-session callback), unless the
   * caller starts the game itself (`announce: false`, used to pass the track's category along).
   */
  startSession(sessionId, track, { announce = true } = {}) {
    this.sessionId = sessionId;
    this.sessionEnded = false;
    this.track = track;
    for (const p of this.players.values()) p.record = null;
    this.pending = { sessionId, resetCounter: 0, states: [] };
    if (announce) for (const cb of [...this.cb.newSession]) safe(() => cb(sessionId, this.gameMode, track.trackMetadata, track.trackData), "newSession");
  }
  /** Forget the times set so far in this session (a cup race starts after its warmup). */
  clearRecords() {
    for (const p of this.players.values()) p.record = null;
    this.firePlayersChanged();
  }
  endSession(sessionId) {
    if (sessionId !== this.sessionId || this.sessionEnded) return;
    this.sessionEnded = true;
    this.flush();
    for (const cb of [...this.cb.endSession]) safe(() => cb(), "endSession");
  }
  /** Binary relay frame from the server. */
  handleRelay(bytes) {
    let relay;
    try {
      relay = decodeCarRelay(bytes);
    } catch (err) {
      log.warn("bad car relay frame", err);
      return;
    }
    if (relay.sessionId !== this.sessionId || relay.slot === this.matchSlot) return;
    this.stats.relaysReceived++;
    for (const stateBytes of relay.states) {
      let decoded;
      try {
        decoded = decodeCarState(stateBytes).carState;
      } catch (err) {
        log.warn("bad car state", err);
        continue;
      }
      normalizeQuaternion(decoded.quaternion);
      this.stats.statesApplied++;
      for (const cb of [...this.cb.carUpdate]) safe(() => cb(relay.sessionId, relay.slot, relay.resetCounter, decoded), "carUpdate");
    }
  }
  handleCarReset(sessionId, slot, resetCounter) {
    if (sessionId !== this.sessionId || slot === this.matchSlot) return;
    for (const cb of [...this.cb.carReset]) safe(() => cb(sessionId, slot, resetCounter), "carReset");
  }
  serverMessage(text) {
    for (const cb of [...this.cb.serverMessage]) safe(() => cb(text), "serverMessage");
  }
  /** @param {"disconnected"|"kicked"} reason */
  connectionLost(reason) {
    if (this.lost) return;
    this.lost = reason;
    for (const cb of [...this.cb.connectionLost]) safe(() => cb(reason), "connectionLost");
  }
};

// mod/src/tracks.js
var registryCache = null;
var trackDataClass = null;
function registryTracks(bridge) {
  if (registryCache) return registryCache;
  const map = /* @__PURE__ */ new Map();
  const add = (category) => (id, group, trackMetadata, environment, loadCallback) => {
    map.set(id, { id, name: trackMetadata?.name ?? id, category, loadCallback });
  };
  try {
    bridge.trackRegistry.forEachOfficialTrack(add("official"));
    bridge.trackRegistry.forEachCommunityTrack(add("community"));
  } catch (err) {
    log.warn("could not enumerate the track registry", err);
  }
  registryCache = map;
  return map;
}
async function getTrackDataClass(bridge, game) {
  if (trackDataClass) return trackDataClass;
  if (game?.TrackCodec?.fromExportString) {
    trackDataClass = game.TrackCodec;
    return trackDataClass;
  }
  const first = registryTracks(bridge).values().next().value;
  if (first) {
    const loaded = await first.loadCallback();
    trackDataClass = loaded.trackData.constructor;
  }
  return trackDataClass;
}
async function resolveTrack(bridge, game, info) {
  let result = null;
  const entry = info.id ? registryTracks(bridge).get(info.id) : null;
  if (entry) {
    result = await entry.loadCallback();
  } else if (info.trackCode) {
    const TrackData = await getTrackDataClass(bridge, game);
    if (!TrackData?.fromExportString) throw new Error("track codec unavailable");
    result = TrackData.fromExportString(info.trackCode);
  } else if (info.trackUrl) {
    const TrackData = await getTrackDataClass(bridge, game);
    if (!TrackData?.fromExportString) throw new Error("track codec unavailable");
    const res = await fetch(info.trackUrl);
    if (!res.ok) throw new Error(`failed to fetch track (${res.status})`);
    result = TrackData.fromExportString(await res.text());
  }
  if (!result?.trackData || !result.trackMetadata) throw new Error(`unknown track ${info.name ?? info.id ?? ""}`);
  if (typeof result.trackData.hasStartingPoint === "function" && !result.trackData.hasStartingPoint()) {
    throw new Error("track has no starting point");
  }
  const category = entry?.category ?? (["official", "community", "custom"].includes(info.category) ? info.category : "custom");
  return { trackMetadata: result.trackMetadata, trackData: result.trackData, category, id: info.id ?? null };
}

// mod/src/match.js
var MatchController = class extends Emitter {
  constructor({ client, bridge, game, hud, popups }) {
    super();
    this.client = client;
    this.bridge = bridge;
    this.game = game;
    this.hud = hud;
    this.popups = popups ?? bridge.popups;
    this.match = null;
    this.connection = null;
    this.track = null;
    this.round = 0;
    this.sessionId = null;
    this.startsAt = 0;
    this.endsAt = 0;
    this.phase = "idle";
    this.gameStarted = false;
    this.countdownOpen = false;
    this._countdownTimer = null;
    this.matchEnd = null;
    this.prefetched = null;
    this._unsubs = [];
    this.listen();
  }
  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
    this.stopCountdown();
  }
  get active() {
    return this.match != null && this.phase !== "finished";
  }
  listen() {
    const on = (type, fn) => this._unsubs.push(this.client.on(type, (msg) => safe(() => fn(msg), type)));
    on(MSG.MATCH_FOUND, (msg) => this.onMatchFound(msg));
    on(MSG.MATCH_RESUME, (msg) => this.onMatchResume(msg));
    on(MSG.ROUND_START, (msg) => this.onRoundStart(msg));
    on(MSG.ROUND_CLOCK, (msg) => this.onRoundClock(msg));
    on(MSG.RECORDS, (msg) => this.onRecords(msg));
    on(MSG.ROUND_END, (msg) => this.onRoundEnd(msg));
    on(MSG.MATCH_END, (msg) => this.onMatchEnd(msg));
    on(MSG.PLAYER_LEFT, (msg) => this.onPlayerLeft(msg));
    on(MSG.PLAYER_STATUS, (msg) => this.onPlayerStatus(msg));
    on(MSG.PINGS, (msg) => this.connection?.setPings(msg.pings));
    on(MSG.CAR_RESET, (msg) => this.connection?.handleCarReset(msg.sessionId, msg.slot, msg.resetCounter));
    on(MSG.SERVER_MESSAGE, (msg) => this.connection?.serverMessage(msg.text));
    this._unsubs.push(this.client.on("binary", (bytes) => this.connection?.handleRelay(bytes)));
    this._unsubs.push(
      this.client.on("state", ({ state }) => {
        if (state === "disconnected" && this.active && this.connection) {
          this.hud.showToast("Connection lost \u2013 trying to reconnect\u2026", 6e3);
        }
      })
    );
  }
  isSameMatch(msg) {
    return this.match && msg.matchId === this.match.matchId;
  }
  // ------------------------------------------------------------- match found / resume
  async onMatchFound(msg) {
    if (msg.format?.cup) return;
    if (this.active && this.match.matchId !== msg.matchId) {
      log.warn("received a new match while one is active; abandoning the old one");
      this.cleanup();
    }
    this.match = msg;
    this.matchEnd = null;
    this.phase = "loading";
    this.round = 0;
    this.gameStarted = false;
    this.hud.show(msg, msg.you);
    this.emit("started", msg);
    try {
      this.track = await resolveTrack(this.bridge, this.game, msg.track);
    } catch (err) {
      log.error("failed to load the match track", err);
      this.emit("error", `Could not load track "${msg.track?.name ?? "?"}": ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: msg.matchId });
      this.cleanup();
      return;
    }
    if (this.match !== msg) return;
    this.connection = this.createConnection(msg);
    this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
  }
  async onMatchResume(msg) {
    if (msg.format?.cup) return;
    log.info("resuming match", msg.matchId, "phase", msg.phase);
    this.cleanup({ keepHud: false });
    this.match = msg;
    this.matchEnd = null;
    this.phase = msg.phase === "finished" ? "finished" : "loading";
    this.hud.show(msg, msg.you);
    try {
      this.track = await resolveTrack(this.bridge, this.game, msg.track);
    } catch (err) {
      this.emit("error", `Could not load track: ${err.message}`);
      this.cleanup();
      return;
    }
    if (this.match !== msg) return;
    this.connection = this.createConnection(msg);
    if (msg.phase === "finished") return;
    if (msg.round > 0) {
      this.onRoundStart({ matchId: msg.matchId, round: msg.round, sessionId: msg.sessionId, track: msg.track, startsAt: msg.startsAt, endsAt: msg.endsAt, scores: msg.scores, players: msg.players });
      if (msg.phase === "results" || msg.phase === "closing") this.connection.endSession(msg.sessionId);
      if (msg.records) this.onRecords({ matchId: msg.matchId, sessionId: msg.sessionId, records: msg.records });
    } else {
      this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
    }
  }
  createConnection(msg) {
    const connection = new RankedConnection({
      client: this.client,
      matchSlot: msg.you,
      players: msg.players,
      carStyleCodec: this.game.CarStyle ?? this.carStyleClassFromProfile(),
      gameMode: this.game.competitiveMode,
      onDispose: () => this.onConnectionDisposed(connection),
      onAttached: (sessionId) => this.onStateAttached(sessionId)
    });
    return connection;
  }
  carStyleClassFromProfile() {
    try {
      return this.bridge.profiles.getCurrentUserProfile().carStyle.constructor;
    } catch {
      return null;
    }
  }
  // ------------------------------------------------------------- rounds
  async onRoundStart(msg) {
    if (!this.isSameMatch(msg) || !this.connection) return;
    this.round = msg.round;
    this.sessionId = msg.sessionId;
    this.startsAt = msg.startsAt;
    this.endsAt = msg.endsAt;
    this.phase = "countdown";
    if (msg.players) this.connection.setPlayers(msg.players);
    this.hud.setPlayers(msg.players ?? this.match.players);
    this.hud.setRound(msg.round, msg.startsAt, msg.endsAt, msg.scores);
    if (msg.track && this.track && msg.track.id !== this.match.track?.id) {
      try {
        this.track = this.prefetched?.id === msg.track.id ? this.prefetched.track : await resolveTrack(this.bridge, this.game, msg.track);
        this.prefetched = null;
        this.match.track = msg.track;
      } catch (err) {
        log.error("failed to load the round track", err);
      }
    }
    if (this.sessionId !== msg.sessionId || !this.connection) return;
    this.connection.startSession(msg.sessionId, this.track);
    if (!this.gameStarted) this.startGame();
  }
  startGame() {
    const info = { multiplayerConnection: this.connection, sessionId: this.sessionId, gameMode: this.game.competitiveMode };
    try {
      this.bridge.startGame(this.track.trackMetadata, this.track.trackData, "custom", [], info, false);
      this.gameStarted = true;
    } catch (err) {
      log.error("failed to start the game", err);
      this.emit("error", `Could not start the match: ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
    }
  }
  /** The game created its in-game state for `sessionId`; run the countdown gate. */
  onStateAttached(sessionId) {
    if (sessionId !== this.sessionId) return;
    this.runCountdown();
  }
  runCountdown() {
    this.stopCountdown();
    const tick = () => {
      if (!this.active || this.phase !== "countdown") return this.stopCountdown();
      const left = this.startsAt - this.client.serverNow();
      if (left <= 0) {
        this.phase = "racing";
        this.stopCountdown();
        this.hud.showToast("GO!", 1500);
        return;
      }
      const secs = Math.ceil(left / 1e3);
      const text = `Round ${this.round} starts in ${secs}`;
      try {
        this.popups.showNoButtons(text);
        this.countdownOpen = true;
      } catch (err) {
        log.warn("countdown popup failed", err);
      }
      this._countdownTimer = setTimeout(tick, Math.min(250, left));
    };
    tick();
  }
  stopCountdown() {
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    this._countdownTimer = null;
    if (this.countdownOpen) {
      this.countdownOpen = false;
      safe(() => this.popups.hide(), "popups.hide");
    }
  }
  onRoundClock(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.endsAt = msg.endsAt;
    this.hud.setEndsAt(msg.endsAt);
  }
  onRecords(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.connection?.setRecords(msg.records ?? {});
    this.hud.setRecords(msg.records ?? {});
  }
  onRoundEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.phase = msg.matchOver ? "finished" : "results";
    this.stopCountdown();
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    const records = {};
    for (const r of msg.results ?? []) if (r.frames != null) records[r.slot] = r.frames;
    this.connection?.setRecords(records);
    this.connection?.endSession(msg.sessionId);
    this.hud.setRecords(records);
    this.hud.setScores(msg.scores);
    const myPoints = msg.results?.find((r) => r.slot === this.match.you)?.points ?? 0;
    let text;
    if (msg.roundWinner?.type === "team") {
      const myTeam = this.match.players.find((p) => p.slot === this.match.you)?.team;
      text = msg.roundWinner.team === myTeam ? `Round ${msg.round} won!` : `Round ${msg.round} lost`;
    } else if (msg.roundWinner?.type === "player") {
      const name = this.match.players.find((p) => p.slot === msg.roundWinner.slot)?.nickname ?? "?";
      text = msg.roundWinner.slot === this.match.you ? `You won round ${msg.round}!` : `${name} won round ${msg.round}`;
    } else text = `Round ${msg.round}: draw`;
    if (this.match.format.scoring !== "duel") text += ` (+${myPoints})`;
    this.hud.showToast(text, msg.nextRoundIn ? msg.nextRoundIn : 6e3);
  }
  prefetchTrack(info) {
    if (!info?.id || this.prefetched?.id === info.id) return;
    resolveTrack(this.bridge, this.game, info).then((track) => {
      this.prefetched = { id: info.id, track };
    }).catch((err) => log.warn("could not preload the next track", err));
  }
  onMatchEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.phase = "finished";
    this.matchEnd = msg;
    this.stopCountdown();
    this.connection?.endSession(this.sessionId);
    this.hud.setScores(msg.scores);
    this.hud.showMatchEnd(msg, {
      onBackToMenu: () => this.leaveToMenu(false),
      onQueueAgain: () => this.leaveToMenu(true)
    });
    this.emit("ended", msg);
  }
  onPlayerLeft(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players.find((x) => x.slot === msg.slot);
    if (p) p.active = false;
    this.connection?.removePlayer(msg.slot);
    this.hud.setPlayers(this.match.players);
  }
  onPlayerStatus(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players.find((x) => x.slot === msg.slot);
    if (p) {
      p.connected = msg.connected;
      this.hud.setPlayers(this.match.players);
    }
  }
  // ------------------------------------------------------------- leaving
  /** Called when the game disposes our connection (Exit button, lost connection, state change). */
  onConnectionDisposed(connection) {
    if (connection !== this.connection) return;
    if (this.active) {
      log.info("left the match");
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.emit("left");
    }
    this.cleanup();
  }
  leaveToMenu(queueAgain) {
    const wasActive = this.active;
    const matchId = this.match?.matchId;
    this.hud.hide();
    const connection = this.connection;
    this.connection = null;
    try {
      this.bridge.backToMenu(false, null);
    } catch (err) {
      log.error("backToMenu failed", err);
    }
    if (connection && !connection.disposed) connection.dispose();
    if (wasActive && matchId) this.client.send({ type: MSG.LEAVE_MATCH, matchId });
    this.cleanup();
    if (queueAgain) this.emit("queueAgain");
  }
  cleanup({ keepHud = false } = {}) {
    this.stopCountdown();
    const connection = this.connection;
    this.connection = null;
    if (connection && !connection.disposed) connection.dispose();
    this.match = null;
    this.track = null;
    this.prefetched = null;
    this.phase = "idle";
    this.round = 0;
    this.sessionId = null;
    this.gameStarted = false;
    if (!keepHud) this.hud.hide();
  }
};

// mod/src/ui/styles.js
var STYLE_ID = "polyranked-styles";
var CSS = `
.polyranked-menu-button img { filter: none; }
.polyranked-ui, .polyranked-hud, .polyranked-overlay { font-family: ForcedSquare, Arial, sans-serif; color: var(--text-color, #fff); }
.polyranked-ui { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(10, 14, 36, 0.55); z-index: 50; }
.polyranked-ui.hidden { display: none; }
.polyranked-ui .pr-box { width: 760px; max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow: auto; background: var(--surface-secondary-color, #212b58); box-shadow: 0 0 40px rgba(0,0,0,0.5); }
.polyranked-ui h2 { margin: 0; padding: 10px 20px; font-weight: normal; font-size: 38px; text-align: center; background: var(--surface-color, #28346a); }
.polyranked-ui h3 { margin: 0 0 8px 0; font-weight: normal; font-size: 24px; opacity: 0.9; }
.polyranked-ui .pr-section { margin: 10px; padding: 14px 18px; background: var(--surface-color, #28346a); }
.polyranked-ui .pr-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.polyranked-ui .pr-status { font-size: 20px; opacity: 0.9; }
.polyranked-ui .pr-status.err { color: #ff9696; }
.polyranked-ui .pr-status.ok { color: #9cf59c; }
.polyranked-ui .pr-profile { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.polyranked-ui .pr-name { font-size: 30px; }
.polyranked-ui .pr-ratings { display: flex; gap: 10px; flex-wrap: wrap; }
.polyranked-ui .pr-rating { padding: 8px 12px; background: var(--surface-secondary-color, #212b58); min-width: 150px; }
.polyranked-ui .pr-rating .pr-q { font-size: 18px; opacity: 0.8; }
.polyranked-ui .pr-rating .pr-div { font-size: 24px; }
.polyranked-ui .pr-rating .pr-num { font-size: 20px; opacity: 0.85; }
.polyranked-ui .pr-queues { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.polyranked-ui .pr-queue { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 12px; background: var(--surface-secondary-color, #212b58); }
.polyranked-ui .pr-queue .pr-qname { font-size: 26px; }
.polyranked-ui .pr-queue .pr-qinfo { font-size: 18px; opacity: 0.8; }
.polyranked-ui .pr-searching { display: flex; align-items: center; gap: 14px; font-size: 26px; }
.polyranked-ui .pr-spinner { width: 28px; height: 28px; border-radius: 50%; border: 4px solid var(--surface-tertiary-color, #192042); border-left-color: #fff; animation: pr-spin 0.9s linear infinite; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.polyranked-ui input[type=text] { font-family: inherit; font-size: 22px; padding: 6px 10px; background: var(--surface-tertiary-color, #192042); color: #fff; border: none; width: 100%; box-sizing: border-box; }
.polyranked-ui label { font-size: 18px; opacity: 0.85; display: block; margin-bottom: 4px; }
.polyranked-ui .pr-buttons { display: flex; gap: 10px; justify-content: flex-end; padding: 10px; background: var(--surface-color, #28346a); flex-wrap: wrap; }
.polyranked-ui table { width: 100%; border-collapse: collapse; font-size: 20px; }
.polyranked-ui td, .polyranked-ui th { padding: 4px 8px; text-align: left; }
.polyranked-ui th { font-weight: normal; opacity: 0.7; }
.polyranked-ui tr.self td { color: #ffe08a; }
.polyranked-ui .pr-small { font-size: 16px; opacity: 0.7; }
.polyranked-ui .pr-link { color: #9cc7ff; }

.polyranked-hud { position: absolute; right: 12px; top: 120px; width: 300px; pointer-events: none; z-index: 20; }
.polyranked-hud.hidden { display: none; }
.polyranked-hud .pr-card { background: var(--surface-transparent-color, rgba(40,52,106,0.6)); padding: 8px 12px; margin-bottom: 8px; }
.polyranked-hud .pr-title { font-size: 20px; opacity: 0.8; display: flex; justify-content: space-between; }
.polyranked-hud .pr-score { font-size: 34px; display: flex; justify-content: space-between; align-items: baseline; }
.polyranked-hud .pr-timer { font-size: 30px; text-align: center; }
.polyranked-hud .pr-timer.warn { color: #ff9696; }
.polyranked-hud .pr-list { font-size: 19px; }
.polyranked-hud .pr-list .pr-line { display: flex; justify-content: space-between; gap: 8px; }
.polyranked-hud .pr-list .pr-line.self { color: #ffe08a; }
.polyranked-hud .pr-list .pr-line.t0 .pr-team { color: #7fb8ff; }
.polyranked-hud .pr-list .pr-line.t1 .pr-team { color: #ff9c7a; }
.polyranked-hud .pr-toast { font-size: 22px; text-align: center; padding: 6px; background: rgba(0,0,0,0.35); }

.polyranked-overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(10, 14, 36, 0.75); z-index: 60; }
.polyranked-overlay.hidden { display: none; }
.polyranked-overlay .pr-box { width: 700px; max-width: calc(100% - 40px); background: var(--surface-secondary-color, #212b58); }
.polyranked-overlay h2 { margin: 0; padding: 10px 20px; font-weight: normal; font-size: 40px; text-align: center; background: var(--surface-color, #28346a); }
.polyranked-overlay .pr-result { font-size: 46px; text-align: center; padding: 14px; }
.polyranked-overlay .pr-result.win { color: #9cf59c; }
.polyranked-overlay .pr-result.loss { color: #ff9696; }
.polyranked-overlay .pr-section { margin: 10px; padding: 12px 18px; background: var(--surface-color, #28346a); }
.polyranked-overlay table { width: 100%; border-collapse: collapse; font-size: 22px; }
.polyranked-overlay td { padding: 4px 8px; }
.polyranked-overlay tr.self td { color: #ffe08a; }
.polyranked-overlay .pr-delta.up { color: #9cf59c; }
.polyranked-overlay .pr-delta.down { color: #ff9696; }
.polyranked-overlay .pr-buttons { display: flex; gap: 10px; justify-content: flex-end; padding: 10px; background: var(--surface-color, #28346a); }
.polyranked-overlay .pr-lobby-status { font-size: 26px; text-align: center; padding: 10px 14px; }
.polyranked-overlay .pr-lobby-countdown { font-size: 34px; text-align: center; padding: 0 0 10px 0; color: #ffe08a; }
.polyranked-overlay .pr-winner { font-size: 40px; text-align: center; padding: 10px; color: #ffe08a; }
.polyranked-overlay td.pr-place { width: 40px; opacity: 0.8; }
.polyranked-overlay td.pr-right { text-align: right; }

.polyranked-cup { position: absolute; left: 0; bottom: calc(100% + 16px); width: 700px; box-sizing: border-box; background: var(--surface-secondary-color, #212b58); font-family: ForcedSquare, Arial, sans-serif; color: var(--text-color, #fff); }
.polyranked-cup .pr-cup-body { padding: 12px 16px 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.polyranked-cup .pr-cup-title { display: flex; align-items: center; gap: 10px; font-size: 30px; }
.polyranked-cup .pr-cup-title img { width: 34px; height: 34px; }
.polyranked-cup .pr-cup-status { font-size: 19px; opacity: 0.85; min-height: 1.3em; }
.polyranked-cup .pr-cup-status.err { color: #ff9696; opacity: 1; }
.polyranked-cup .pr-cup-join { width: 100%; box-sizing: border-box; margin: 0; padding: 14px 20px; font-size: 38px; text-align: center; justify-content: center; }
.polyranked-cup .pr-cup-join .button-icon { margin-right: 10px; }

/* ---- the cup's in-game overlay (PolyCup-style) ---- */
.prc-hud, .prc-pov, .prc-pb, .prc-round-timer, .prc-start-cue, .prc-downtime, .prc-practice, .prc-notice { font-family: ForcedSquare, Arial, sans-serif; font-style: italic; color: #fff; --prc-deep: #192042; --prc-blue: #212b58; --prc-muted: #b3c7df; --prc-gold: #ffd26b; --prc-cut: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-hud { position: absolute; left: 0; top: 0; width: min(420px, calc(100vw - 8px)); max-height: calc(100% - 70px); overflow: hidden; pointer-events: none; z-index: 22; display: flex; flex-direction: column; gap: 3px; transition: top .18s ease-out; }
.prc-hud.hidden, .prc-pov.hidden, .prc-pb.hidden, .prc-start-cue.hidden, .prc-downtime.hidden, .prc-practice.hidden, .prc-notice.hidden { display: none; }
.prc-summary { display: flex; flex-direction: column; gap: 3px; }
.prc-track { background: var(--prc-deep); padding: 9px 18px; clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); }
.prc-track > strong { display: block; font-size: 30px; font-weight: normal; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 6px; }
.prc-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; font-size: 18px; text-transform: uppercase; }
.prc-meta > span { color: var(--prc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prc-meta > strong { font-weight: normal; white-space: nowrap; }
.prc-phase { margin-top: 5px; font-size: 18px; color: var(--prc-gold); }
.prc-record { display: grid; grid-template-columns: 30px minmax(0, 1fr) 100px; gap: 7px; align-items: center; padding: 6px 18px; font-size: 18px; background: var(--prc-blue); clip-path: var(--prc-cut); }
.prc-record > strong:first-child { font-weight: normal; color: #ff9150; }
.prc-record.prc-tr > strong:first-child { color: var(--prc-gold); }
.prc-record .prc-holder { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-right: 4px; }
.prc-record .prc-rtime { text-align: right; font-size: 24px; font-weight: normal; }
.prc-board { margin-top: 23px; display: flex; flex-direction: column; gap: 4px; }
.prc-heading { display: flex; justify-content: center; padding: 10px 18px; background: #112052; clip-path: var(--prc-cut); }
.prc-heading > strong { font-size: 26px; font-weight: bold; }
.prc-winner { padding: 10px 18px; border-top: 2px solid var(--prc-gold); background: #273c3b; clip-path: var(--prc-cut); font-size: 26px; }
.prc-winner > small { display: block; color: var(--prc-gold); font-size: 18px; margin-bottom: 4px; }
.prc-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 76px 110px; align-items: center; gap: 4px; min-height: 34px; padding: 1px 0 1px 18px; font-size: 18px; background: var(--prc-blue); clip-path: var(--prc-cut); }
.prc-board.has-movement .prc-row { grid-template-columns: 20px minmax(0, 1fr) 24px 76px 110px; }
.prc-board:not(.has-movement) .prc-move { display: none; }
.prc-row.self { background: #ed7833; color: #111e34; }
.prc-row.pending { opacity: .7; }
.prc-row.winner { background: #273c3b; }
.prc-pos { font-size: 20px; font-weight: normal; color: #aec2d9; }
.prc-row.self .prc-pos { color: #111e34; }
.prc-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.prc-name > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 4px; }
.prc-row.self .prc-name > span { text-decoration: underline; text-underline-offset: 3px; }
.prc-car { width: 32px; height: 28px; flex: 0 0 32px; object-fit: contain; }
.prc-move { font-size: 18px; text-align: right; }
.prc-move.up { color: #76e8ba; } .prc-move.down { color: #ff9d9d; }
.prc-row.self .prc-move.up { color: #0b4d35; } .prc-row.self .prc-move.down { color: #7a1d1d; }
.prc-points { display: flex; justify-content: flex-end; align-items: center; gap: 5px; padding-right: 5px; }
.prc-points > strong { font-size: 24px; font-weight: normal; }
.prc-points > small { font-size: 18px; color: #76e8ba; }
.prc-points > small.projected { color: var(--prc-gold); }
.prc-row.self .prc-points > small { color: #0b4d35; }
.prc-time { align-self: stretch; display: flex; justify-content: center; align-items: center; margin: 2px 10px 2px 0; padding: 0 10px; background: #e9f1f8; color: #152238; font-size: 20px; white-space: nowrap; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-round-timer { position: absolute; right: 0; bottom: 164px; min-width: 106px; padding: 9px 20px 9px 28px; box-sizing: border-box; background: var(--prc-deep); clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%); color: #ff747c; font-size: 36px; line-height: 1; text-align: center; font-variant-numeric: tabular-nums; pointer-events: none; transform: translateX(100%); opacity: 0; transition: transform .22s ease-out, opacity .15s ease-out; z-index: 22; }
.prc-round-timer.visible { transform: translateX(0); opacity: 1; }
.prc-start-cue { position: absolute; left: 50%; top: 32%; transform: translate(-50%, -50%); font-size: 120px; line-height: 1; color: #fff; text-shadow: 0 4px 10px rgba(0,0,0,.5); pointer-events: none; z-index: 23; animation: prc-pop .5s ease-out; }
.prc-start-cue.go { color: #9cf59c; }
@keyframes prc-pop { from { transform: translate(-50%, -50%) scale(1.3); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
.prc-downtime { position: absolute; left: 50%; top: 27%; transform: translateX(-50%); font-size: clamp(24px, 2.5vw, 36px); line-height: 1.2; text-align: center; text-shadow: 0 2px 3px #101a3c, 0 0 12px #101a3c; pointer-events: none; z-index: 22; white-space: nowrap; }
.prc-practice { position: absolute; right: 18px; bottom: 164px; z-index: 22; }
.prc-practice-box { display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 18px; background: var(--prc-deep); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 22px; }
.prc-practice-box > span { color: var(--prc-muted); }
.prc-practice-box > strong { min-width: 42px; text-align: right; font-weight: normal; }
.prc-practice-box .button.prc-ready { min-width: 112px; margin: 0; padding: 8px 18px; font-size: 22px; }
.prc-pov { position: absolute; left: 50%; bottom: 118px; transform: translateX(-50%); width: min(420px, calc(100vw - 24px)); z-index: 22; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.prc-pov-box { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; gap: 6px; width: 100%; }
.prc-pov .button.prc-pov-cycle { margin: 0; padding: 0; height: 44px; display: flex; align-items: center; justify-content: center; }
.prc-arrow { width: 10px; height: 10px; border-top: 3px solid currentColor; border-right: 3px solid currentColor; transform: rotate(45deg); }
.prc-arrow.left { transform: rotate(-135deg); }
.prc-pov-main { min-width: 0; height: 44px; padding: 6px 12px; box-sizing: border-box; background: #112052; clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%); }
.prc-pov-name { display: flex; align-items: center; justify-content: center; height: 32px; padding: 0 12px; background: #e9f1f8; color: #152238; font-size: 26px; line-height: 32px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 100%, 0 100%); }
.prc-pov-hint { font-size: 16px; color: var(--prc-muted); text-shadow: 0 1px 2px #101a3c; }
.prc-pb { position: absolute; right: 8px; bottom: 118px; display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 6px; width: 196px; height: 34px; padding-left: 14px; box-sizing: border-box; background: var(--prc-blue); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 20px; white-space: nowrap; z-index: 22; }
.prc-pb > span { color: #78e1b6; }
.prc-pb > strong { display: flex; align-items: center; justify-content: center; align-self: stretch; margin: 3px 8px 3px 0; padding: 0 8px; background: #e9f1f8; color: #152238; font-size: 22px; font-weight: normal; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-notice { position: absolute; left: 50%; bottom: 196px; transform: translateX(-50%); padding: 10px 20px; background: #112052; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 22px; pointer-events: none; max-width: calc(100vw - 32px); text-align: center; z-index: 23; }
@media (max-height: 700px) { .prc-row { min-height: 28px; } .prc-car { height: 23px; } .prc-track > strong { font-size: 26px; } }
`;
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// mod/src/ui/mainmenu.js
var BUTTON_CLASS = "polyranked-menu-button";
var TROPHY_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#fff" d="M18 8h28v6h8v8c0 7-5 12-11 13-2 4-6 7-9 8v7h8v6H22v-6h8v-7c-3-1-7-4-9-8C15 34 10 29 10 22v-8h8V8zm0 12h-3v2c0 3 2 6 5 7-1-3-2-6-2-9zm28 0c0 3-1 6-2 9 3-1 5-4 5-7v-2h-3z"/></svg>`
);
function installMainMenuButton(onClick) {
  const ui = document.getElementById("ui");
  if (!ui) return () => {
  };
  const tryInject = () => {
    const img = ui.querySelector('button.button-image img[src="images/multiplayer.svg"]');
    const mpButton = img?.closest("button");
    if (!mpButton || !mpButton.parentElement) return;
    if (mpButton.parentElement.querySelector("." + BUTTON_CLASS)) return;
    const button = el("button", {
      className: mpButton.className + " " + BUTTON_CLASS,
      on: {
        click: (ev) => {
          ev.preventDefault();
          onClick();
        }
      }
    });
    button.appendChild(el("img", { attrs: { src: TROPHY_SVG, alt: "" } }));
    button.appendChild(el("p", { text: "Ranked" }));
    mpButton.insertAdjacentElement("afterend", button);
  };
  const observer = new MutationObserver(() => tryInject());
  observer.observe(ui, { childList: true, subtree: true });
  tryInject();
  return () => observer.disconnect();
}

// mod/src/ui/cupbutton.js
var BOX_CLASS = "polyranked-cup";
function installCupButton({ onJoin, onLeave, fetchState, localState, serverNow, intervalMs = 5e3 }) {
  const ui = document.getElementById("ui");
  if (!ui) return { dispose() {
  }, refresh() {
  } };
  let box = null;
  let state = null;
  let stateAt = 0;
  let unreachable = false;
  let pollTimer = null;
  let tickTimer = null;
  let busy = false;
  let titleText = null;
  let statusEl = null;
  let button = null;
  let buttonIcon = null;
  let buttonText = null;
  const build = (body) => {
    titleText = el("span", { text: state?.name ?? "Quickplay Cup" });
    body.appendChild(el("div", { className: "pr-cup-title" }, [el("img", { attrs: { src: TROPHY_SVG, alt: "" } }), titleText]));
    statusEl = el("div", { className: "pr-cup-status" });
    body.appendChild(statusEl);
    buttonIcon = el("img", { className: "button-icon", attrs: { src: "images/play.svg" } });
    buttonText = document.createTextNode("Join the Cup");
    button = el("button", {
      className: "button pr-cup-join",
      on: {
        click: (ev) => {
          ev.preventDefault();
          if (busy) return;
          busy = true;
          setTimeout(() => busy = false, 1500);
          localState().inCup ? onLeave() : onJoin();
          render();
        }
      }
    });
    button.appendChild(buttonIcon);
    button.appendChild(buttonText);
    body.appendChild(button);
  };
  const render = () => {
    if (!box || !box.isConnected || !button) return;
    const local = localState();
    titleText.textContent = state?.name ?? "Quickplay Cup";
    statusEl.textContent = statusText(local);
    statusEl.classList.toggle("err", !!local.notice);
    buttonIcon.src = local.inCup ? "images/back.svg" : "images/play.svg";
    buttonText.data = local.inCup ? "Leave the cup" : "Join the Cup";
    button.disabled = !!state && state.enabled === false;
  };
  const statusText = (local) => {
    if (local.notice) return local.notice;
    if (local.inCup) {
      if (local.phase === "warmup") return local.racing ? "You are in the cup \u2013 warmup" : "You are in the cup \u2013 you race from the next round";
      if (local.phase === "racing" || local.phase === "countdown") return local.racing ? "You are in the cup \u2013 live round" : "You are in the cup \u2013 watching this round, you race the next one";
      if (local.phase === "complete") return "You are in the cup \u2013 the next cup starts shortly";
      return "You are in the cup \u2013 waiting for the next round";
    }
    if (unreachable && !state) return "Cup server unreachable \u2013 check the server address in the Ranked menu";
    if (!state) return "Checking the cup\u2026";
    if (state.enabled === false) return "This server has no cup";
    const n = state.players.length;
    const now = serverNow();
    const leader = state.standings?.[0];
    const lead = leader && leader.points > 0 ? ` \xB7 ${leader.nickname} leads with ${leader.points} pts` : "";
    const track = state.track?.name ? ` on ${state.track.name}` : "";
    const roundInfo = `round ${state.round} (${state.trackRounds}/${state.roundsPerTrack})`;
    switch (state.phase) {
      case "idle":
        return n === 0 ? `Always on \xB7 nobody racing right now \u2013 be the first (first to ${state.target} pts)` : `${n} waiting for racers${track} \xB7 ${state.minPlayers} needed to start`;
      case "break":
        return `${n} racing${track} \xB7 ${state.round ? `next round in ${formatSeconds((state.nextAt - now) / 1e3)}` : `round 1 starts in ${formatSeconds((state.nextAt - now) / 1e3)}`}${lead}`;
      case "loading":
      case "warmup":
        return `${n} racing${track} \xB7 ${state.phase === "warmup" ? "warmup before" : "loading"} ${roundInfo}${lead} \xB7 join now and race this round's successor`;
      case "countdown":
      case "racing":
        return `${n} racing${track} \xB7 live ${roundInfo}${lead} \xB7 join to watch and race the next round`;
      case "complete":
        return `Cup #${state.cupNumber} won by ${state.lastWinner?.nickname ?? "?"} \xB7 next cup starts in ${formatSeconds((state.nextAt - now) / 1e3)}`;
      default:
        return `${n} in the cup`;
    }
  };
  const poll = async () => {
    try {
      const next = await fetchState();
      if (next) {
        state = next;
        stateAt = Date.now();
        unreachable = false;
      } else unreachable = true;
    } catch {
      unreachable = true;
    }
    render();
  };
  const tryInject = () => {
    const join = ui.querySelector(".multiplayer-ui > .join");
    if (!join) {
      if (box) {
        box = null;
        stopPolling();
      }
      return;
    }
    if (join.querySelector("." + BOX_CLASS)) return;
    const body = el("div", { className: "pr-cup-body" });
    box = el("div", { className: BOX_CLASS }, [body]);
    build(body);
    join.insertBefore(box, join.firstChild);
    render();
    startPolling();
  };
  const startPolling = () => {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, intervalMs);
    tickTimer = setInterval(render, 1e3);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    pollTimer = tickTimer = null;
  };
  const observer = new MutationObserver(() => tryInject());
  observer.observe(ui, { childList: true, subtree: true });
  tryInject();
  return {
    dispose() {
      observer.disconnect();
      stopPolling();
      box?.remove();
      box = null;
    },
    refresh() {
      render();
    },
    /** Push a fresh state (welcome.cup, cup_state) without waiting for the next poll. */
    setState(next) {
      if (!next) return;
      state = next;
      stateAt = Date.now();
      unreachable = false;
      render();
    },
    /** @returns {number} age of the cached state in ms */
    get stateAge() {
      return Date.now() - stateAt;
    }
  };
}

// mod/src/ui/menu.js
var RankedMenu = class extends Emitter {
  constructor({ settings }) {
    super();
    this.settings = settings;
    this.connectionState = { state: "disconnected", detail: null };
    this.profile = null;
    this.queues = [];
    this.queueStatus = null;
    this.canQueue = true;
    this.queueReason = null;
    this.notice = null;
    this.leaderboard = null;
    this.view = "main";
    this.root = el("div", { className: "polyranked-ui hidden", on: { click: (ev) => ev.target === this.root && this.close() } });
    this.box = el("div", { className: "pr-box" });
    this.root.appendChild(this.box);
    document.getElementById("ui")?.appendChild(this.root);
    this._timer = null;
    this.render();
  }
  dispose() {
    this.stopTimer();
    this.root.remove();
  }
  get isOpen() {
    return !this.root.classList.contains("hidden");
  }
  open() {
    this.root.classList.remove("hidden");
    this.render();
    this.startTimer();
  }
  close() {
    this.root.classList.add("hidden");
    this.stopTimer();
    this.emit("close");
  }
  toggle() {
    this.isOpen ? this.close() : this.open();
  }
  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => {
      if (this.queueStatus && this.waitLabel) this.waitLabel.textContent = this.queueText();
    }, 500);
  }
  stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  // ------------------------------------------------------------- state setters
  setConnectionState(state, detail) {
    this.connectionState = { state, detail };
    if (state !== "ready") this.queueStatus = null;
    this.render();
  }
  setWelcome(welcome) {
    this.profile = welcome.profile;
    this.queues = welcome.queues ?? [];
    this.canQueue = welcome.canQueue !== false;
    this.queueReason = welcome.queueReason ?? null;
    this.render();
  }
  setProfile(profile) {
    this.profile = profile;
    this.render();
  }
  setQueueStatus(status) {
    this.queueStatus = status && status.inQueue !== false ? { ...status, receivedAt: Date.now() } : null;
    this.render();
  }
  setNotice(text, kind = "info") {
    this.notice = text ? { text, kind } : null;
    this.render();
  }
  setLeaderboard(data) {
    this.leaderboard = data;
    if (this.view === "leaderboard") this.render();
  }
  setSettings(settings) {
    this.settings = settings;
    this.render();
  }
  queueText() {
    const s = this.queueStatus;
    if (!s) return "";
    const waited = (s.waitedMs ?? 0) + (Date.now() - s.receivedAt);
    return `Searching ${this.queueName(s.queueId)}\u2026 ${formatSeconds(waited / 1e3)}  (${s.waiting}/${s.required} in queue)`;
  }
  queueName(id) {
    return this.queues.find((q) => q.id === id)?.name ?? id;
  }
  // ------------------------------------------------------------- rendering
  render() {
    clearChildren(this.box);
    this.box.appendChild(el("h2", { text: "Ranked" }));
    if (this.view === "leaderboard") this.renderLeaderboard();
    else if (this.view === "settings") this.renderSettings();
    else this.renderMain();
  }
  button(text, onClick, { disabled = false, icon = null } = {}) {
    const b = el("button", { className: "button", on: { click: onClick } });
    if (icon) b.appendChild(el("img", { className: "button-icon", attrs: { src: icon } }));
    b.appendChild(document.createTextNode(text));
    b.disabled = disabled;
    return b;
  }
  statusLine() {
    const { state, detail } = this.connectionState;
    let text;
    let cls = "pr-status";
    if (state === "ready") {
      text = `Connected to ${this.settings.serverUrl}`;
      cls += " ok";
    } else if (state === "connected") text = "Signing in\u2026";
    else if (state === "connecting") text = `Connecting to ${this.settings.serverUrl}\u2026`;
    else {
      text = detail ? `Offline \u2013 ${detail}` : "Offline";
      cls += " err";
    }
    return el("div", { className: cls, text });
  }
  renderMain() {
    const { state } = this.connectionState;
    const conn = el("div", { className: "pr-section" });
    const row = el("div", { className: "pr-row" }, [this.statusLine()]);
    if (state === "disconnected") row.appendChild(this.button("Connect", () => this.emit("connect")));
    else row.appendChild(this.button("Disconnect", () => this.emit("disconnect")));
    conn.appendChild(row);
    if (this.notice) conn.appendChild(el("div", { className: "pr-status " + (this.notice.kind === "error" ? "err" : ""), text: this.notice.text, style: { marginTop: "8px" } }));
    this.box.appendChild(conn);
    if (this.profile) {
      const ratings = el("div", { className: "pr-ratings" });
      for (const q of this.queues) {
        const r = this.profile.ratings?.[q.id];
        if (!r) continue;
        ratings.appendChild(
          el("div", { className: "pr-rating" }, [
            el("div", { className: "pr-q", text: q.name }),
            el("div", { className: "pr-div", text: r.label }),
            el("div", { className: "pr-num", text: `${r.rating} pts \xB7 ${r.wins}W ${r.losses}L` })
          ])
        );
      }
      this.box.appendChild(
        el("div", { className: "pr-section pr-profile" }, [el("div", { className: "pr-name", text: this.profile.nickname }), ratings])
      );
    }
    if (state === "ready") {
      const section = el("div", { className: "pr-section" });
      if (this.queueStatus) {
        this.waitLabel = el("div", { text: this.queueText() });
        section.appendChild(el("div", { className: "pr-searching" }, [el("div", { className: "pr-spinner" }), this.waitLabel]));
        section.appendChild(el("div", { className: "pr-row", style: { marginTop: "10px", justifyContent: "flex-end" } }, [this.button("Cancel", () => this.emit("cancelQueue"))]));
      } else {
        section.appendChild(el("h3", { text: "Play" }));
        if (!this.canQueue && this.queueReason) section.appendChild(el("div", { className: "pr-status err", text: this.queueReason }));
        const grid = el("div", { className: "pr-queues" });
        for (const q of this.queues) {
          const format = q.teams ? `${q.teamSize}v${q.teamSize} \xB7 first to ${q.roundsToWin} rounds` : `${q.players} players \xB7 ${q.maxRounds} rounds`;
          grid.appendChild(
            el("div", { className: "pr-queue" }, [
              el("div", { className: "pr-qname", text: q.name }),
              el("div", { className: "pr-qinfo", text: format }),
              el("div", { className: "pr-qinfo", text: `${q.waiting ?? 0} in queue` }),
              this.button("Queue", () => this.emit("queue", q.id), { disabled: !this.canQueue })
            ])
          );
        }
        section.appendChild(grid);
      }
      this.box.appendChild(section);
    }
    const buttons = el("div", { className: "pr-buttons" }, [
      el("span", { className: "pr-small", text: `PolyRanked ${MOD_VERSION}`, style: { marginRight: "auto", alignSelf: "center" } }),
      this.button("Leaderboard", () => {
        this.view = "leaderboard";
        this.emit("leaderboard", this.queues[0]?.id ?? "duel");
        this.render();
      }, { disabled: state !== "ready" }),
      this.button("Settings", () => {
        this.view = "settings";
        this.render();
      }),
      this.button("Close", () => this.close())
    ]);
    this.box.appendChild(buttons);
  }
  renderLeaderboard() {
    const section = el("div", { className: "pr-section" });
    const tabs = el("div", { className: "pr-row", style: { marginBottom: "10px" } });
    for (const q of this.queues) {
      tabs.appendChild(this.button(q.name, () => this.emit("leaderboard", q.id), { disabled: this.leaderboard?.queue === q.id }));
    }
    section.appendChild(tabs);
    if (!this.leaderboard) section.appendChild(el("div", { className: "pr-status", text: "Loading\u2026" }));
    else if (this.leaderboard.entries.length === 0) section.appendChild(el("div", { className: "pr-status", text: "Nobody has finished their placement matches yet." }));
    else {
      const table = el("table");
      table.appendChild(el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Player" }), el("th", { text: "Division" }), el("th", { text: "Rating" }), el("th", { text: "W / L" })]));
      for (const e of this.leaderboard.entries) {
        table.appendChild(
          el("tr", { className: e.id === this.profile?.id ? "self" : "" }, [
            el("td", { text: String(e.position) }),
            el("td", { text: e.nickname }),
            el("td", { text: e.division }),
            el("td", { text: String(e.rating) }),
            el("td", { text: `${e.wins} / ${e.losses}` })
          ])
        );
      }
      section.appendChild(table);
    }
    this.box.appendChild(section);
    this.box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back", () => {
          this.view = "main";
          this.render();
        })
      ])
    );
  }
  renderSettings() {
    const section = el("div", { className: "pr-section" });
    const urlInput = el("input", { attrs: { type: "text", spellcheck: "false", autocomplete: "off" } });
    urlInput.value = this.settings.serverUrl;
    const nameInput = el("input", { attrs: { type: "text", spellcheck: "false", autocomplete: "off", maxlength: "24", placeholder: "Use my PolyTrack nickname" } });
    nameInput.value = this.settings.nameOverride ?? "";
    const auto = el("input", { attrs: { type: "checkbox" } });
    auto.checked = this.settings.autoConnect !== false;
    const hud = el("input", { attrs: { type: "checkbox" } });
    hud.checked = this.settings.showHud !== false;
    section.appendChild(el("label", { text: "Ranked server (ws:// or wss://)" }));
    section.appendChild(urlInput);
    section.appendChild(el("label", { text: "Nickname override", style: { marginTop: "12px" } }));
    section.appendChild(nameInput);
    section.appendChild(el("label", { style: { marginTop: "12px" } }, [auto, " Connect automatically when the game starts"]));
    section.appendChild(el("label", {}, [hud, " Show the match HUD"]));
    section.appendChild(el("div", { className: "pr-small", text: "Your identity is a random key stored in this browser; clearing site data resets your rating.", style: { marginTop: "12px" } }));
    this.box.appendChild(section);
    this.box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back", () => {
          this.view = "main";
          this.render();
        }),
        this.button("Save", () => {
          const patch = { serverUrl: normalizeServerUrl(urlInput.value), nameOverride: nameInput.value.trim().slice(0, 24), autoConnect: auto.checked, showHud: hud.checked };
          this.view = "main";
          this.emit("settings", patch);
        })
      ])
    );
  }
};

// mod/src/ui/hud.js
var MatchHud = class {
  constructor({ serverNow }) {
    this.serverNow = serverNow;
    this.root = el("div", { className: "polyranked-hud hidden" });
    this.overlay = el("div", { className: "polyranked-overlay hidden" });
    const ui = document.getElementById("ui");
    ui?.appendChild(this.root);
    ui?.appendChild(this.overlay);
    this.match = null;
    this.you = null;
    this.round = 0;
    this.startsAt = 0;
    this.endsAt = 0;
    this.scores = null;
    this.records = {};
    this.toast = null;
    this._toastTimer = null;
    this._timer = null;
    this.enabled = true;
  }
  dispose() {
    this.stopTimer();
    this.root.remove();
    this.overlay.remove();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.root.classList.add("hidden");
    else if (this.match) this.root.classList.remove("hidden");
  }
  show(match, you) {
    this.match = match;
    this.you = you;
    this.round = 0;
    this.scores = null;
    this.records = {};
    if (this.enabled) this.root.classList.remove("hidden");
    this.render();
    this.startTimer();
  }
  hide() {
    this.match = null;
    this.root.classList.add("hidden");
    this.hideOverlay();
    this.stopTimer();
  }
  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => this.renderTimer(), 250);
  }
  stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  setPlayers(players) {
    if (this.match) this.match.players = players;
    this.render();
  }
  setRound(round, startsAt, endsAt, scores) {
    this.round = round;
    this.startsAt = startsAt;
    this.endsAt = endsAt;
    if (scores) this.scores = scores;
    this.records = {};
    this.render();
  }
  setEndsAt(endsAt) {
    this.endsAt = endsAt;
    this.renderTimer();
  }
  setRecords(records) {
    this.records = records ?? {};
    this.render();
  }
  setScores(scores) {
    this.scores = scores;
    this.render();
  }
  showToast(text, ms = 4e3) {
    this.toast = text;
    this.render();
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast = null;
      this.render();
    }, ms);
  }
  // ------------------------------------------------------------- helpers
  me() {
    return this.match?.players.find((p) => p.slot === this.you) ?? null;
  }
  teamLabel(team) {
    return team === 0 ? "Blue" : "Red";
  }
  scoreHeadline() {
    const f = this.match?.format;
    if (!f || !this.scores) return "";
    if (f.scoring === "duel" || f.scoring === "teams") {
      const rw = this.scores.roundWins ?? [0, 0];
      const myTeam = this.me()?.team ?? 0;
      return `${rw[myTeam]} \u2013 ${rw[1 - myTeam]}`;
    }
    const pts = this.scores.points ?? {};
    return `${pts[this.you] ?? 0} pts`;
  }
  // ------------------------------------------------------------- rendering
  roundLabel() {
    const f = this.match.format;
    if (!this.round) return "Loading\u2026";
    return `Round ${this.round} \xB7 ${f.roundsToWin ? `first to ${f.roundsToWin}` : `of ${f.maxRounds}`}`;
  }
  render() {
    if (!this.match) return;
    clearChildren(this.root);
    const f = this.match.format;
    this.root.appendChild(
      el("div", { className: "pr-card" }, [
        el("div", { className: "pr-title" }, [el("span", { text: this.match.queueName }), el("span", { text: this.roundLabel() })]),
        el("div", { className: "pr-score" }, [el("span", { text: this.scoreHeadline() }), this.timerEl = el("span", { className: "pr-timer" })])
      ])
    );
    const list = el("div", { className: "pr-card pr-list" });
    const players = [...this.match.players].sort((a, b) => {
      const ra = this.records[a.slot];
      const rb = this.records[b.slot];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.slot - b.slot;
    });
    for (const p of players) {
      const cls = ["pr-line", p.slot === this.you ? "self" : "", p.team != null ? `t${p.team}` : ""].join(" ");
      const points = this.scores?.points?.[p.slot] ?? 0;
      list.appendChild(
        el("div", { className: cls }, [
          el("span", {}, [p.team != null ? el("span", { className: "pr-team", text: "\u25A0 " }) : null, p.nickname + (p.active === false ? " (left)" : "")]),
          el("span", { text: `${formatFrames(this.records[p.slot] ?? null)}${f.scoring === "points" || f.scoring === "teams" ? ` \xB7 ${points}` : ""}` })
        ])
      );
    }
    this.root.appendChild(list);
    if (this.toast) this.root.appendChild(el("div", { className: "pr-card pr-toast", text: this.toast }));
    this.renderTimer();
  }
  renderTimer() {
    if (!this.timerEl || !this.match) return;
    const now = this.serverNow();
    if (!this.round) {
      this.timerEl.textContent = "";
      return;
    }
    if (now < this.startsAt) {
      this.timerEl.textContent = `GO in ${Math.ceil((this.startsAt - now) / 1e3)}`;
      this.timerEl.classList.remove("warn");
    } else {
      const left = Math.max(0, this.endsAt - now);
      this.timerEl.textContent = formatSeconds(left / 1e3);
      this.timerEl.classList.toggle("warn", left < 1e4);
    }
  }
  /** Full-screen match summary with rating changes. */
  showMatchEnd({ winner, reason, scores, ratings, players }, { onBackToMenu, onQueueAgain }) {
    clearChildren(this.overlay);
    const me = players.find((p) => p.slot === this.you);
    const myResult = ratings?.[this.you]?.result ?? "draw";
    const headline = myResult === "win" ? "VICTORY" : myResult === "loss" ? "DEFEAT" : "DRAW";
    const box = el("div", { className: "pr-box" }, [el("h2", { text: "Match over" }), el("div", { className: "pr-result " + myResult, text: headline })]);
    const reasonText = reason === "forfeit" ? "Opponents left the match" : reason === "draw" ? "The match ended in a draw" : winner?.type === "team" && me?.team != null ? `${this.teamLabel(winner.team)} team wins` : "";
    if (reasonText) box.appendChild(el("div", { className: "pr-section", text: reasonText }));
    const table = el("table");
    const sorted = [...players].sort((a, b) => (scores?.points?.[b.slot] ?? 0) - (scores?.points?.[a.slot] ?? 0));
    for (const p of sorted) {
      const r = ratings?.[p.slot];
      const delta = r ? r.delta >= 0 ? `+${r.delta}` : `${r.delta}` : "";
      table.appendChild(
        el("tr", { className: p.slot === this.you ? "self" : "" }, [
          el("td", { text: (p.team != null ? `[${this.teamLabel(p.team)}] ` : "") + p.nickname }),
          el("td", { text: `${scores?.points?.[p.slot] ?? 0} pts` }),
          el("td", { text: r ? `${r.after}` : "" }),
          el("td", { className: "pr-delta " + (r && r.delta >= 0 ? "up" : "down"), text: delta }),
          el("td", { text: r?.division ?? "" })
        ])
      );
    }
    box.appendChild(el("div", { className: "pr-section" }, [table]));
    box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back to menu", onBackToMenu),
        this.button("Queue again", onQueueAgain)
      ])
    );
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
  }
  button(text, onClick) {
    return el("button", { className: "button", text, on: { click: onClick } });
  }
  hideOverlay() {
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
  }
};

// mod/src/cup/controller.js
var ROUND_PHASES = /* @__PURE__ */ new Set(["loading", "warmup", "countdown", "racing"]);
var RACE_PHASES = /* @__PURE__ */ new Set(["countdown", "racing"]);
function isEditing(ev) {
  return ev.composedPath().some((t) => ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);
}
var CupController = class extends Emitter {
  constructor({ client, bridge, game, native, hud }) {
    super();
    this.client = client;
    this.bridge = bridge;
    this.game = game;
    this.native = native;
    this.hud = hud;
    this.match = null;
    this.state = null;
    this.you = null;
    this.connection = null;
    this.track = null;
    this.prefetched = null;
    this.sessionId = null;
    this.gameStarted = false;
    this.runtime = null;
    this.view = { watchSlot: null, freecam: false, freecamGame: null, following: false, followingGame: null, cockpit: false };
    this.activeGame = null;
    this.gameInfo = null;
    this.uploadsGame = null;
    this.thumbnails = /* @__PURE__ */ new Map();
    this._unsubs = [];
    this.listen();
    if (native) {
      installGameHooks(native, {
        onGameUpdate: (g, dt) => this.onGameUpdate(g, dt),
        beforeRender: (g, dt) => this.beforeRender(g, dt),
        onGameDisposed: (g) => this.onGameDisposed(g),
        shouldBlockControls: (g) => this.shouldBlockControls(g),
        handleRestart: (g) => this.handleRestart(g)
      });
    }
    this.onKeyDown = (ev) => this.keyDown(ev);
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    hud?.bind?.(this);
  }
  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    this.cleanup();
  }
  get active() {
    return this.match != null;
  }
  get phase() {
    return this.state?.phase ?? null;
  }
  get live() {
    return this.state?.live ?? null;
  }
  get rules() {
    return this.state?.rules ?? {};
  }
  serverNow() {
    return this.client.serverNow();
  }
  listen() {
    const on = (type, fn) => this._unsubs.push(this.client.on(type, (msg) => safe(() => fn(msg), type)));
    on(MSG.MATCH_FOUND, (msg) => this.onMatchFound(msg));
    on(MSG.MATCH_RESUME, (msg) => this.onMatchResume(msg));
    on(MSG.ROUND_START, (msg) => this.onRoundStart(msg));
    on(MSG.ROUND_END, (msg) => this.onRoundEnd(msg));
    on(MSG.CUP_STATE, (msg) => this.onCupState(msg));
    on(MSG.CUP_END, (msg) => this.onCupEnd(msg));
    on(MSG.RECORDS, (msg) => this.onRecords(msg));
    on(MSG.PLAYER_LEFT, (msg) => this.onPlayerLeft(msg));
    on(MSG.PLAYER_STATUS, (msg) => this.onPlayerStatus(msg));
    on(MSG.PINGS, (msg) => this.isSameMatch(msg) && this.connection?.setPings(msg.pings));
    on(MSG.CAR_RESET, (msg) => this.isSameMatch(msg) && this.connection?.handleCarReset(msg.sessionId, msg.slot, msg.resetCounter));
    on(MSG.SERVER_MESSAGE, (msg) => this.isSameMatch(msg) && this.connection?.serverMessage(msg.text));
    this._unsubs.push(this.client.on("binary", (bytes) => this.connection?.handleRelay(bytes)));
    this._unsubs.push(
      this.client.on("state", ({ state }) => {
        if (state === "disconnected" && this.active && this.connection) this.hud.notice("Connection lost \u2013 trying to reconnect\u2026", 6e3);
      })
    );
  }
  isSameMatch(msg) {
    return !!this.match && msg.matchId === this.match.matchId;
  }
  // ------------------------------------------------------------- joining
  async onMatchFound(msg) {
    if (!msg.format?.cup) return;
    if (this.active) this.cleanup({ keepHud: true });
    await this.enter(msg, "joined");
  }
  async onMatchResume(msg) {
    if (!msg.format?.cup) return;
    this.cleanup({ keepHud: true });
    await this.enter(msg, "resumed");
  }
  async enter(msg, how) {
    this.match = msg;
    this.you = msg.you;
    this.applyState(msg.cup, { silent: true });
    this.hud.show();
    if (!ROUND_PHASES.has(msg.phase)) this.hud.showLobby();
    this.emit("started", msg);
    const track = await this.loadTrack(msg.track);
    if (this.match !== msg) return;
    if (!track) return;
    this.track = track;
    this.connection = this.createConnection(msg);
    this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
    log.info(`${how} the cup (slot ${msg.you}, phase ${msg.phase})`);
    if (ROUND_PHASES.has(msg.phase) && msg.sessionId) this.enterSession(msg.sessionId, { racer: msg.cup?.live?.racers?.includes(msg.you) ?? false });
  }
  async loadTrack(info) {
    try {
      return await resolveTrack(this.bridge, this.game, info);
    } catch (err) {
      log.error("failed to load the cup track", err);
      this.emit("error", `Could not load track "${info?.name ?? "?"}": ${err.message}`);
      if (this.match) this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
      return null;
    }
  }
  createConnection(msg) {
    const connection = new RankedConnection({
      client: this.client,
      matchSlot: msg.you,
      players: msg.players,
      carStyleCodec: this.game.CarStyle ?? this.carStyleClassFromProfile(),
      gameMode: this.gameMode(),
      transformRecord: (frames) => this.lapFrames(frames),
      onDispose: () => this.onConnectionDisposed(connection),
      onAttached: (sessionId) => this.onStateAttached(sessionId)
    });
    return connection;
  }
  carStyleClassFromProfile() {
    try {
      return this.bridge.profiles.getCurrentUserProfile().carStyle.constructor;
    } catch {
      return null;
    }
  }
  gameMode() {
    const mode = this.state?.gameMode ?? this.match?.format?.gameMode;
    return typeof mode === "number" ? mode : this.game.competitiveMode;
  }
  // ------------------------------------------------------------- rounds
  newRuntime(sessionId, racer) {
    return {
      sessionId,
      racer,
      attached: false,
      readySent: false,
      warmupReadySent: false,
      stage: null,
      // "warmup" | "race"
      startedCar: null,
      hookedCar: null,
      timeOffset: 0,
      // round time spent before the current car (restarts before the first checkpoint)
      done: false,
      finishFrames: null,
      retired: false,
      checkpointSent: -1
    };
  }
  async onRoundStart(msg) {
    if (!this.isSameMatch(msg) || !this.connection) return;
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    this.hud.hideLobby();
    if (msg.players) this.connection.setPlayers(msg.players);
    if (msg.track && (!this.track || msg.track.id !== this.track.id)) {
      const track = this.prefetched?.id === msg.track.id ? this.prefetched.track : await this.loadTrack(msg.track);
      if (!track) return;
      this.prefetched = null;
      this.track = track;
      if (this.match) this.match.track = msg.track;
    }
    if (!this.connection || this.state?.live?.sessionId !== msg.sessionId) return;
    this.enterSession(msg.sessionId, { racer: Array.isArray(msg.racers) ? msg.racers.includes(this.you) : true });
    this.hud.update();
  }
  /** Start (or restart) the game on the current track for a session. */
  enterSession(sessionId, { racer }) {
    this.sessionId = sessionId;
    this.runtime = this.newRuntime(sessionId, racer);
    this.view.watchSlot = null;
    this.view.freecam = false;
    this.view.freecamGame = null;
    this.connection.startSession(sessionId, this.track, { announce: false });
    const info = { multiplayerConnection: this.connection, sessionId, gameMode: this.gameMode() };
    try {
      this.bridge.startGame(this.track.trackMetadata, this.track.trackData, this.track.category ?? "custom", [], info, false);
      this.gameStarted = true;
    } catch (err) {
      log.error("failed to start the cup round", err);
      this.emit("error", `Could not start the round: ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
    }
  }
  /** The game created its in-game state for `sessionId`. */
  onStateAttached(sessionId) {
    const rt = this.runtime;
    if (!rt || rt.sessionId !== sessionId) return;
    rt.attached = true;
  }
  sendRoundReady(game) {
    const rt = this.runtime;
    if (!rt || rt.readySent) return;
    rt.readySent = true;
    const trackId = this.track?.id ?? this.gameInfo?.trackId ?? null;
    const pb = this.localPersonalBest(game, trackId);
    this.client.send({ type: MSG.CUP_ROUND_READY, matchId: this.match.matchId, sessionId: rt.sessionId, pb });
    this.onlinePersonalBest(trackId).then((frames) => {
      if (frames != null && this.runtime === rt && (pb == null || frames < pb)) {
        this.client.send({ type: MSG.CUP_ROUND_READY, matchId: this.match.matchId, sessionId: rt.sessionId, pb: frames });
      }
    });
  }
  localPersonalBest(game, trackId) {
    if (!trackId || !this.native) return null;
    try {
      const store = this.native.store(game);
      const profiles = this.native.profiles(game);
      const frames = store?.getRecordTime?.(profiles.profileSlot, trackId)?.numberOfFrames;
      return Number.isInteger(frames) && frames > 0 ? frames : null;
    } catch {
      return null;
    }
  }
  async onlinePersonalBest(trackId) {
    if (!trackId || typeof this.bridge.api?.getLeaderboardUserEntry !== "function") return null;
    try {
      const profile = this.bridge.profiles.getCurrentUserProfile();
      const verified = this.track?.category === "official" || this.track?.category === "community";
      const entry = await Promise.race([this.bridge.api.getLeaderboardUserEntry(profile.tokenHash, trackId, verified), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6e3))]);
      const frames = entry?.frames?.numberOfFrames ?? entry?.time?.numberOfFrames ?? (typeof entry?.frames === "number" ? entry.frames : null);
      return Number.isInteger(frames) && frames > 0 ? frames : null;
    } catch {
      return null;
    }
  }
  onRoundEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.connection?.endSession(msg.sessionId);
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    const mine = msg.results?.find((r) => r.slot === this.you);
    if (mine && this.runtime?.racer) {
      const place = mine.position ? `${mine.position}${["st", "nd", "rd"][mine.position - 1] ?? "th"}` : "DNF";
      this.hud.notice(`Round ${msg.round}: ${place}${mine.points ? ` \xB7 +${mine.points}` : ""}`, 4e3);
    }
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    this.releaseView();
    this.hud.update();
  }
  onRecords(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.connection?.setRecords(msg.records ?? {});
  }
  onCupState(msg) {
    if (!this.isSameMatch(msg) || !msg.cup) return;
    this.applyState(msg.cup);
  }
  onCupEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.connection?.endSession(this.sessionId);
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    const won = msg.winner?.slot === this.you;
    this.hud.notice(won ? "You win the cup!" : `${msg.winner?.nickname ?? "?"} wins the cup`, 6e3);
    this.releaseView();
    this.hud.update();
  }
  applyState(state, { silent = false } = {}) {
    if (!state) return;
    const before = this.state;
    this.state = state;
    if (state.players && this.connection) this.connection.setPlayers(state.players);
    if (this.match && state.players) this.match.players = state.players;
    if (!silent && before) {
      if (state.phase === "idle" && before.phase !== "idle" && this.gameStarted) this.hud.notice("Waiting for more racers\u2026", 5e3);
      if (state.phase === "warmup" && before.phase !== "warmup" && this.runtime?.racer) this.hud.notice(this.rules.readyEndsWarmup ? "Warmup \u2013 press Ready when you are done practising" : "Warmup", 5e3);
    }
    this.hud.update();
    this.emit("state", state);
  }
  prefetchTrack(info) {
    if (!info?.id || this.prefetched?.id === info.id) return;
    resolveTrack(this.bridge, this.game, info).then((track) => {
      this.prefetched = { id: info.id, track };
    }).catch((err) => log.warn("could not preload the next track", err));
  }
  onPlayerLeft(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players?.find((x) => x.slot === msg.slot);
    if (p) p.active = false;
    this.connection?.removePlayer(msg.slot);
    this.hud.update();
  }
  onPlayerStatus(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players?.find((x) => x.slot === msg.slot);
    if (p) p.connected = msg.connected;
    this.hud.update();
  }
  // ------------------------------------------------------------- live round (game hooks)
  /** Round time of a car time: the car's clock plus what earlier attempts of this run took. */
  lapFrames(frames) {
    const rt = this.runtime;
    return frames + (rt && rt.stage === "race" ? rt.timeOffset : 0);
  }
  isRacer() {
    return !!this.runtime?.racer;
  }
  /** Finished or retired in the running round. */
  roundDone(slot = this.you) {
    const live = this.live;
    if (slot === this.you && this.runtime?.done) return true;
    return !!live && (live.finishes?.[slot] != null || (live.dnfs ?? []).includes(slot));
  }
  /** The session the game shows is the round's session. */
  inLiveSession() {
    const live = this.live;
    const info = this.gameInfo;
    return !!live && !!info && !!this.runtime && info.sessionId === live.sessionId && this.runtime.sessionId === live.sessionId;
  }
  raceStarted() {
    const live = this.live;
    return !!live && RACE_PHASES.has(this.phase) && live.startsAt != null && this.serverNow() >= live.startsAt;
  }
  /** Called before every frame of an in-game state. @returns {boolean} whether it is the cup's game */
  onGameUpdate(game, dt) {
    if (!this.connection || !this.native) return false;
    const info = this.native.read(game);
    if (info.connection !== this.connection) return false;
    this.activeGame = game;
    this.gameInfo = info;
    if (this.uploadsGame !== game) {
      this.uploadsGame = game;
      safe(() => this.native.setUploads(game, this.rules.uploadLeaderboardTimes !== false), "setUploads");
    }
    const rt = this.runtime;
    if (!rt || info.sessionId !== rt.sessionId) return true;
    if (rt.attached && !rt.readySent) this.sendRoundReady(game);
    if (!rt.racer || !this.inLiveSession()) return true;
    const phase = this.phase;
    const stage = phase === "warmup" ? "warmup" : RACE_PHASES.has(phase) ? "race" : null;
    if (stage && rt.stage !== stage) {
      rt.stage = stage;
      rt.startedCar = null;
      rt.timeOffset = 0;
      rt.checkpointSent = -1;
      this.releaseView(game);
      safe(() => this.native.reset(game), "reset");
      this.connection.clearRecords();
      this.gameInfo = this.native.read(game);
    }
    const car = this.gameInfo.car;
    if (stage === "race" && car && rt.hookedCar !== car) {
      rt.hookedCar = car;
      this.hookCar(game, car, rt);
    }
    if (stage === "race" && car && this.raceStarted() && !rt.done && rt.startedCar !== car) {
      rt.startedCar = car;
      this.releaseView(game);
      if (this.gameInfo.spectator) this.gameInfo.spectator.isEnabled = false;
      rt.timeOffset = Math.max(rt.timeOffset, Math.floor(this.serverNow() - this.live.startsAt) - car.getTime().numberOfFrames);
      safe(() => car.start(), "car.start");
    }
    return true;
  }
  hookCar(game, car, rt) {
    car.addCheckpointCallback(() => {
      if (this.runtime !== rt || this.gameInfo?.car !== car) return;
      this.reportCheckpoint(car.getNextCheckpointIndex() - 1, this.lapFrames(car.getTime().numberOfFrames));
    });
    car.addFinishCallback(() => {
      if (this.runtime !== rt || this.gameInfo?.car !== car) return;
      this.reportFinish(this.lapFrames(car.getTime().numberOfFrames));
    });
  }
  /** A checkpoint of the live round (round time in frames). */
  reportCheckpoint(index, frames) {
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    if (!Number.isInteger(index) || index < 0 || index <= rt.checkpointSent) return false;
    rt.checkpointSent = index;
    if (rt.timeOffset > 0 && this.activeGame) safe(() => this.native.showRoundCheckpoint(this.activeGame, frames), "showRoundCheckpoint");
    this.client.send({ type: MSG.CUP_CHECKPOINT, matchId: this.match?.matchId, sessionId: rt.sessionId, index, frames });
    return true;
  }
  /** The finish of the live round (round time in frames). */
  reportFinish(frames) {
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    rt.done = true;
    rt.finishFrames = frames;
    if (rt.timeOffset > 0 && this.activeGame) safe(() => this.native.showRoundFinish(this.activeGame, frames), "showRoundFinish");
    this.client.send({ type: MSG.RECORD, matchId: this.match?.matchId, sessionId: rt.sessionId, frames });
    this.hud.update();
    return true;
  }
  /** Retire from the live round (restart key). */
  retire() {
    const rt = this.runtime;
    if (!rt || !rt.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    rt.done = true;
    rt.retired = true;
    this.client.send({ type: MSG.CUP_DNF, matchId: this.match?.matchId, sessionId: rt.sessionId });
    this.hud.notice("Retired from this round", 3e3);
    this.hud.update();
    return true;
  }
  /** A respawn before the first checkpoint: a new run, but the round clock keeps counting. */
  restartRun(game) {
    const rt = this.runtime;
    const car = this.gameInfo?.car;
    if (!rt || !car || !this.live) return;
    rt.timeOffset = Math.max(this.lapFrames(car.getTime().numberOfFrames), Math.floor(this.serverNow() - this.live.startsAt));
    rt.checkpointSent = -1;
    safe(() => this.native.reset(game), "reset");
    this.gameInfo = this.native.read(game);
  }
  shouldBlockControls(game) {
    if (!this.active || !this.connection || !this.native) return false;
    const info = game === this.activeGame && this.gameInfo ? this.gameInfo : this.native.read(game);
    if (info.connection !== this.connection) return false;
    const rt = this.runtime;
    const live = this.live;
    if (!rt || !live || info.sessionId !== live.sessionId || rt.sessionId !== live.sessionId) return true;
    if (!rt.racer) return true;
    switch (this.phase) {
      case "warmup":
        return false;
      case "countdown":
        return true;
      case "racing":
        return !this.raceStarted() || rt.done;
      default:
        return true;
    }
  }
  /** The game's start-over routine: free in the warmup, otherwise ours (retire / respawn) or nothing. */
  handleRestart(game) {
    if (!this.active || !this.connection || !this.native) return false;
    const info = game === this.activeGame && this.gameInfo ? this.gameInfo : this.native.read(game);
    if (info.connection !== this.connection) return false;
    return !(this.phase === "warmup" && this.runtime?.racer && this.inLiveSession());
  }
  keyDown(ev) {
    if (!this.active || !this.activeGame || !this.native || !this.gameInfo || this.gameInfo.ended) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing || isEditing(ev)) return;
    const game = this.activeGame;
    const info = this.gameInfo;
    const settings = this.native.settings(game);
    const KB = this.native.KeyBinding;
    if (!settings) return;
    if (this.mayWatch()) {
      if (ev.code === "BracketLeft" || ev.code === "BracketRight") {
        ev.preventDefault();
        if (!ev.repeat) this.cycleWatch(ev.code === "BracketLeft" ? -1 : 1);
        return;
      }
      if (settings.checkKeyBinding(ev, KB.ToggleSpectatorCamera)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!ev.repeat) this.toggleFreecam();
        return;
      }
    }
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.inLiveSession() || !this.raceStarted()) return;
    if (info.spectator?.isEnabled) return;
    const checkpointKey = settings.checkKeyBinding(ev, KB.VehicleCheckpointReset);
    const startKey = settings.checkKeyBinding(ev, KB.VehicleStartReset);
    if (startKey && !checkpointKey) {
      ev.preventDefault();
      if (!ev.repeat) this.retire();
      return;
    }
    if (checkpointKey) {
      const car = info.car;
      if (car && !car.hasFinished() && car.getNextCheckpointIndex() === 0) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!ev.repeat) this.restartRun(game);
      }
    }
  }
  // ------------------------------------------------------------- spectating
  /** Allowed to watch the others: a late joiner, or a racer who is done for the round. */
  mayWatch() {
    const info = this.gameInfo;
    const live = this.live;
    if (!info || !live || info.ended || !this.runtime || info.sessionId !== live.sessionId) return false;
    if (!ROUND_PHASES.has(this.phase) || this.phase === "loading") return false;
    return !this.runtime.racer || this.roundDone();
  }
  /** Racers who can be watched right now. */
  watchable() {
    const live = this.live;
    const info = this.gameInfo;
    if (!live || !info?.remoteCars) return [];
    const racing = this.phase === "racing";
    return (live.racers ?? []).filter((slot) => slot !== this.you && (!racing || !this.roundDone(slot)) && info.remoteCars.has(slot) && this.state.players?.find((p) => p.slot === slot)?.connected !== false);
  }
  cycleWatch(delta) {
    const ids = this.watchable();
    if (!ids.length) return;
    const i = ids.indexOf(this.view.watchSlot);
    this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }
  selectWatch(slot) {
    if (!this.watchable().includes(slot)) return;
    this.view.watchSlot = slot;
    this.view.freecam = false;
    this.hud.update();
  }
  toggleFreecam() {
    if (!this.mayWatch() || this.rules.allowSpectatorFreecam === false) return;
    this.view.freecam = !this.view.freecam;
    this.view.freecamGame = null;
    if (!this.view.freecam && this.activeGame) this.releaseView(this.activeGame);
    this.hud.update();
  }
  /** Back to the own car's camera. */
  releaseView(game = this.activeGame) {
    if (this.view.following && game && this.native) safe(() => this.native.release(game, this.view.cockpit), "release");
    this.view.following = false;
    this.view.followingGame = null;
    if (this.view.freecam && game && this.native && this.gameInfo?.spectator) {
      this.gameInfo.spectator.isEnabled = false;
    }
    this.view.freecam = false;
    this.view.freecamGame = null;
  }
  /** Right before the frame is drawn: apply the spectator camera or the round-time display. */
  beforeRender(game, dt) {
    const info = this.gameInfo;
    if (!info || game !== this.activeGame || !this.native) return;
    const rt = this.runtime;
    const mayWatch = this.mayWatch();
    if (this.view.freecam && (!mayWatch || this.rules.allowSpectatorFreecam === false)) {
      this.view.freecam = false;
      this.view.freecamGame = null;
    }
    if (this.view.freecam) {
      if (this.view.freecamGame !== game) {
        if (this.view.following) {
          this.view.following = false;
          this.view.followingGame = null;
        }
        safe(() => this.native.enterFreecam(game), "enterFreecam");
        this.view.freecamGame = game;
      }
      info.car?.setVisible?.(false);
      return;
    }
    const watchable = mayWatch ? this.watchable() : [];
    if (!watchable.length) {
      if (this.view.following) {
        this.view.following = false;
        this.view.followingGame = null;
        safe(() => this.native.release(game, this.view.cockpit), "release");
      }
      if (rt?.racer && rt.stage === "race" && rt.timeOffset > 0 && !rt.done && info.car && this.phase === "racing") {
        safe(() => this.native.showRoundTime(game, this.lapFrames((info.car.getFinishTime?.() ?? info.car.getTime()).numberOfFrames)), "showRoundTime");
      }
      return;
    }
    if (!watchable.includes(this.view.watchSlot)) {
      this.view.watchSlot = watchable[0];
      this.hud.update();
    }
    if (!this.view.following) this.view.cockpit = safe(() => this.native.drivingCockpit(game), "drivingCockpit") === true;
    if (this.native.follow(game, this.view.watchSlot, dt)) {
      if (!this.view.following) this.hud.update();
      this.view.following = true;
      this.view.followingGame = game;
    }
  }
  onGameDisposed(game) {
    if (game !== this.activeGame) return;
    this.view.following = false;
    this.view.followingGame = null;
    this.view.freecamGame = null;
    this.activeGame = null;
    this.gameInfo = null;
  }
  // ------------------------------------------------------------- helpers for the HUD
  playerName(slot) {
    return this.state?.players?.find((p) => p.slot === slot)?.nickname ?? this.match?.players?.find((p) => p.slot === slot)?.nickname ?? "?";
  }
  pbOf(slot) {
    const pb = this.state?.players?.find((p) => p.slot === slot)?.pb;
    return pb === void 0 ? void 0 : pb;
  }
  /** Data URL of a small picture of a player's car (cached by car style). */
  carThumbnail(slot) {
    const style = this.connection?.players?.get(slot)?.carStyle;
    if (!style || !this.native?.carThumbnail || typeof style.serialize !== "function") return Promise.resolve(null);
    const key = style.serialize();
    if (!this.thumbnails.has(key)) {
      if (this.thumbnails.size > 64) this.thumbnails.delete(this.thumbnails.keys().next().value);
      this.thumbnails.set(
        key,
        Promise.resolve().then(() => this.native.carThumbnail(style)).catch(() => null)
      );
    }
    return this.thumbnails.get(key);
  }
  warmupReady() {
    const rt = this.runtime;
    if (!rt || !rt.racer || this.phase !== "warmup" || rt.warmupReadySent) return;
    rt.warmupReadySent = true;
    this.client.send({ type: MSG.CUP_WARMUP_READY, matchId: this.match?.matchId, sessionId: rt.sessionId });
    this.hud.update();
  }
  // ------------------------------------------------------------- leaving
  /** Leave the cup: from the lobby overlay, the multiplayer page, or the game's own Exit. */
  leaveCup() {
    if (!this.active) return;
    const matchId = this.match.matchId;
    if (this.gameStarted) {
      this.leaveToMenu();
    } else {
      this.client.send({ type: MSG.CUP_LEAVE, matchId });
      this.cleanup();
    }
    this.emit("left", { reason: "left" });
  }
  /** The game disposed our connection (Exit button, lost connection, state change). */
  onConnectionDisposed(connection) {
    if (connection !== this.connection) return;
    if (this.active) {
      log.info("left the cup");
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.emit("left", { reason: "exit" });
    }
    this.cleanup();
  }
  leaveToMenu() {
    const matchId = this.match?.matchId;
    const wasActive = this.active;
    this.releaseView();
    this.hud.hide();
    const connection = this.connection;
    this.connection = null;
    try {
      this.bridge.backToMenu(false, null);
    } catch (err) {
      log.error("backToMenu failed", err);
    }
    if (connection && !connection.disposed) connection.dispose();
    if (wasActive && matchId) this.client.send({ type: MSG.LEAVE_MATCH, matchId });
    this.cleanup();
  }
  cleanup({ keepHud = false } = {}) {
    this.releaseView();
    const connection = this.connection;
    this.connection = null;
    if (connection && !connection.disposed) connection.dispose();
    this.match = null;
    this.state = null;
    this.track = null;
    this.prefetched = null;
    this.sessionId = null;
    this.runtime = null;
    this.gameStarted = false;
    this.activeGame = null;
    this.gameInfo = null;
    this.uploadsGame = null;
    this.view = { watchSlot: null, freecam: false, freecamGame: null, following: false, followingGame: null, cockpit: false };
    if (!keepHud) this.hud.hide();
    this.emit("state", null);
  }
};

// shared/cupstandings.js
function liveOrder(live, slots) {
  const finishes = live?.finishes ?? {};
  const splits = live?.splits ?? {};
  const dnfs = new Set(live?.dnfs ?? []);
  const finished = slots.filter((s) => finishes[s] != null).sort((a, b) => finishes[a] - finishes[b] || a - b);
  const pending = slots.filter((s) => finishes[s] == null).sort((a, b) => Number(dnfs.has(a)) - Number(dnfs.has(b)) || (splits[b]?.index ?? -1) - (splits[a]?.index ?? -1) || (splits[a]?.frames ?? Infinity) - (splits[b]?.frames ?? Infinity) || a - b);
  return [...finished, ...pending];
}
function finishPlaces(finishes) {
  const order = Object.keys(finishes).map(Number).sort((a, b) => finishes[a] - finishes[b] || a - b);
  const places = {};
  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    places[slot] = i > 0 && finishes[slot] === finishes[order[i - 1]] ? places[order[i - 1]] : i + 1;
  }
  return places;
}
function cupOrder(state) {
  const players = state.players ?? [];
  const winner = state.winner?.slot ?? null;
  return players.map((p) => p.slot).sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    const pa = players.find((p) => p.slot === a)?.points ?? 0;
    const pb = players.find((p) => p.slot === b)?.points ?? 0;
    return pb - pa || a - b;
  });
}
function standings(state) {
  const players = state.players ?? [];
  const live = state.phase === "racing" && state.live ? state.live : null;
  const last = !live && state.lastRound && state.phase !== "complete" ? state.lastRound : null;
  const rules = state.rules ?? {};
  const points = rules.points ?? [];
  const racers = live ? live.racers ?? [] : [];
  const racingSlots = new Set(racers);
  const order = live ? [...liveOrder(live, racers), ...cupOrder(state).filter((s) => !racingSlots.has(s))] : cupOrder(state);
  const finishes = live ? live.finishes ?? {} : last ? last.finishes ?? {} : {};
  const places = finishPlaces(finishes);
  const best = Object.values(finishes).length ? Math.min(...Object.values(finishes)) : null;
  const splits = live ? live.splits ?? {} : {};
  const dnfs = new Set(live ? live.dnfs ?? [] : last ? last.dnfs ?? [] : []);
  return order.map((slot) => players.find((p) => p.slot === slot)).filter(Boolean).map((p, i) => {
    const slot = p.slot;
    const place = places[slot] ?? null;
    const gain = live ? place ? points[place - 1] ?? 0 : 0 : last ? last.points?.[slot] ?? 0 : 0;
    const split = splits[slot];
    return {
      slot,
      id: p.id,
      nickname: p.nickname,
      position: live && place ? place : i + 1,
      score: p.points ?? 0,
      gain,
      provisional: !!live,
      movement: live ? live.movement?.[slot] ?? 0 : last ? last.movement?.[slot] ?? 0 : 0,
      frames: finishes[slot] ?? null,
      dnf: dnfs.has(slot),
      checkpoint: split ? split.index : null,
      splitFrames: split ? split.frames : null,
      delta: finishes[slot] != null && best != null ? finishes[slot] - best : split && split.bestFrames != null ? split.frames - split.bestFrames : null,
      winner: state.winner?.slot === slot,
      racing: racingSlots.has(slot),
      pending: !!p.pending,
      connected: p.connected !== false
    };
  });
}

// mod/src/cup/hud.js
var PHASE_NAMES = { idle: "Waiting for racers\u2026", break: "Waiting for next round\u2026", loading: "Loading\u2026", warmup: "Warmup", countdown: "Get ready", racing: "Live round", complete: "Cup over" };
var PLACEHOLDER_CAR = "images/car_thumbnail_placeholder.png";
var ORIGINAL_HINT = " to start over.";
var RETIRE_HINT = " to retire from this round.";
function fmtTime(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  const ms = Math.floor(frames);
  return `${Math.floor(ms / 6e4)}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(ms % 1e3).padStart(3, "0")}`;
}
function fmtGap(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  return `+${frames < 6e4 ? (Math.floor(frames) / 1e3).toFixed(3) : fmtTime(frames)}`;
}
var CupHud = class {
  constructor({ serverNow }) {
    this.serverNow = serverNow;
    this.c = null;
    this.enabled = true;
    this.visible = false;
    const ui = document.getElementById("ui") ?? document.body;
    this.root = el("aside", { className: "prc-hud hidden" });
    this.povEl = el("div", { className: "prc-pov hidden" });
    this.pbEl = el("div", { className: "prc-pb hidden" });
    this.timerEl = el("div", { className: "prc-round-timer" });
    this.cueEl = el("div", { className: "prc-start-cue hidden" });
    this.downtimeEl = el("div", { className: "prc-downtime hidden" });
    this.practiceEl = el("div", { className: "prc-practice hidden" });
    this.noticeEl = el("div", { className: "prc-notice hidden" });
    this.overlay = el("div", { className: "polyranked-overlay prc-lobby-overlay hidden" });
    for (const node of [this.root, this.povEl, this.pbEl, this.timerEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl, this.overlay]) ui.appendChild(node);
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
    this.ticker = null;
    this.signature = null;
    this.cueValue = "";
    this.thumbs = /* @__PURE__ */ new Map();
    this.hintNodes = /* @__PURE__ */ new Map();
    this.noticeTimer = null;
    this.toolbarTop = 0;
  }
  bind(controller) {
    this.c = controller;
  }
  dispose() {
    this.hide();
    for (const node of [this.root, this.povEl, this.pbEl, this.timerEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl, this.overlay]) node.remove();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.update(true);
  }
  show() {
    this.visible = true;
    this.signature = null;
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), 100);
    this.update(true);
  }
  hide() {
    this.visible = false;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.hideLobby();
    this.restoreHints();
    for (const node of [this.root, this.povEl, this.pbEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl]) node.classList.add("hidden");
    this.timerEl.classList.remove("visible");
    this.signature = null;
  }
  notice(text, ms = 4e3) {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.toggle("hidden", !text || !this.visible);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.noticeEl.classList.add("hidden"), ms);
  }
  // ------------------------------------------------------------- lobby (main menu)
  showLobby() {
    const c = this.c;
    if (!c?.state) return;
    clearChildren(this.overlay);
    const box = el("div", { className: "pr-box pr-lobby" }, [el("h2", { text: c.state.name })]);
    this.lobbyEl = el("div");
    box.appendChild(this.lobbyEl);
    box.appendChild(el("div", { className: "pr-buttons" }, [this.button("Hide", () => this.hideLobby()), this.button("Leave the cup", () => c.leaveCup())]));
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
    this.renderLobby();
  }
  hideLobby() {
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
  }
  renderLobby() {
    const c = this.c;
    const state = c?.state;
    if (!this.lobbyEl || !state) return;
    clearChildren(this.lobbyEl);
    const n = state.players.length;
    const rules = state.rules ?? {};
    this.lobbyEl.appendChild(
      el("div", { className: "pr-lobby-status", text: `You are in \xB7 ${n} racer${n === 1 ? "" : "s"} \xB7 first to ${rules.target ?? state.target} points \xB7 new track every ${rules.roundsPerTrack ?? state.roundsPerTrack} rounds${state.track?.name ? ` \xB7 next: ${state.track.name}` : ""}` })
    );
    this.lobbyCountdownEl = el("div", { className: "pr-lobby-countdown", text: this.lobbyCountdownText() });
    this.lobbyEl.appendChild(this.lobbyCountdownEl);
    if (state.standings?.length) {
      const table = el("table");
      for (const s of state.standings) {
        table.appendChild(
          el("tr", { className: s.slot === c.you ? "self" : "" }, [
            el("td", { className: "pr-place", text: s.place != null ? `${s.place}.` : "" }),
            el("td", { text: s.nickname + (s.connected === false ? " (reconnecting)" : "") }),
            el("td", { className: "pr-right", text: `${s.points} pts` })
          ])
        );
      }
      this.lobbyEl.appendChild(el("div", { className: "pr-section" }, [table]));
    }
  }
  lobbyCountdownText() {
    const state = this.c?.state;
    if (!state) return "";
    const now = this.serverNow();
    const secs = (at) => Math.max(0, Math.ceil((at - now) / 1e3));
    switch (state.phase) {
      case "idle":
        return state.players.length < state.minPlayers ? `${state.players.length}/${state.minPlayers} racers \u2013 waiting for more` : "Waiting for racers to load";
      case "break":
        return `${state.round ? "Next round" : "Round 1"} starts in ${secs(state.nextAt)} s`;
      case "complete":
        return `Next cup starts in ${secs(state.nextAt)} s`;
      default:
        return `Round ${state.round} is running \u2013 you join the next one`;
    }
  }
  button(text, onClick) {
    return el("button", { className: "button", text, on: { click: onClick } });
  }
  // ------------------------------------------------------------- main panel
  /** Rebuild the panels when something changed (`force` skips the comparison). */
  update(force = false) {
    const c = this.c;
    if (!this.visible || !c?.state) return;
    const state = c.state;
    const live = state.live;
    const rt = c.runtime;
    const key = JSON.stringify([
      this.enabled,
      c.gameStarted,
      c.you,
      state.phase,
      state.round,
      state.trackRounds,
      state.cupNumber,
      state.track?.id,
      state.track?.wr,
      state.track?.tr,
      state.lastTrack?.id,
      state.lastTrack?.tr,
      state.players.map((p) => [p.slot, p.nickname, p.points, p.connected, p.racing, p.pending, p.pb]),
      live && [live.sessionId, live.racers, live.ready, live.warmupReady, live.finishes, live.dnfs, live.splits, live.movement, live.deadline != null],
      state.lastRound && [state.lastRound.round, state.lastRound.points, state.lastRound.movement, state.lastRound.dnfs],
      state.winner?.slot,
      rt && [rt.sessionId, rt.racer, rt.done, rt.retired, rt.warmupReadySent],
      c.view.watchSlot,
      c.view.freecam,
      c.view.following,
      c.mayWatch(),
      c.watchable()
    ]);
    if (!force && key === this.signature) {
      this.renderLobby();
      return;
    }
    this.signature = key;
    this.renderPanel();
    this.renderPractice();
    this.renderSpectator();
    this.renderLobby();
    this.tick();
  }
  renderPanel() {
    const c = this.c;
    const state = c.state;
    const show = this.enabled && c.gameStarted;
    this.root.classList.toggle("hidden", !show);
    clearChildren(this.root);
    if (!show) return;
    const track = !["loading", "warmup", "countdown", "racing"].includes(state.phase) && state.lastTrack ? state.lastTrack : state.track;
    const summary = el("div", { className: "prc-summary" });
    const meta = el("div", { className: "prc-meta" }, [el("span", { text: "Random track" }), el("strong", { text: `ROUND ${state.trackRounds || 1}/${state.roundsPerTrack}` })]);
    this.phaseEl = el("span", { text: this.phaseText() });
    const phase = el("div", { className: "prc-phase" }, [this.phaseEl]);
    summary.appendChild(el("div", { className: "prc-track" }, [el("strong", { text: track?.name ?? state.name }), meta, phase]));
    const wr = track?.wr;
    summary.appendChild(this.recordStrip("WR", "prc-wr", !wr ? "Loading\u2026" : wr.status === "ready" ? wr.nickname : wr.status === "unavailable" ? "Unavailable" : "No record", wr?.status === "ready" ? fmtTime(wr.frames) : "\u2014"));
    const tr = track?.tr;
    summary.appendChild(this.recordStrip("TR", "prc-tr", tr ? (tr.nicknames ?? tr.slots?.map((s) => c.playerName(s)) ?? []).join(" / ") : "No record", tr ? fmtTime(tr.frames) : "\u2014"));
    this.root.appendChild(summary);
    const board = el("div", { className: "prc-board" });
    if (state.winner) board.appendChild(el("div", { className: "prc-winner" }, [el("small", { text: "CUP WINNER" }), el("span", { text: state.winner.nickname })]));
    board.appendChild(el("div", { className: "prc-heading" }, [el("strong", { text: state.phase === "racing" ? "ROUND RANKING" : "CUP STANDINGS" })]));
    const rows = standings(state);
    board.classList.toggle("has-movement", rows.some((r) => r.movement !== 0));
    for (const [i, r] of rows.entries()) {
      const row = el("div", { className: `prc-row${r.slot === c.you ? " self" : ""}${r.pending ? " pending" : ""}${r.winner ? " winner" : ""}` });
      row.appendChild(el("strong", { className: "prc-pos", text: String(r.position) }));
      const img = el("img", { className: "prc-car", attrs: { src: this.thumbs.get(r.slot) ?? PLACEHOLDER_CAR, alt: "", draggable: "false" } });
      if (!this.thumbs.has(r.slot)) {
        c.carThumbnail(r.slot).then((url) => {
          if (url) {
            this.thumbs.set(r.slot, url);
            if (img.isConnected) img.src = url;
          }
        });
      }
      const name = el("span", { className: "prc-name" }, [img, el("span", { text: r.nickname + (r.connected ? "" : " (reconnecting)") })]);
      name.title = r.nickname;
      row.appendChild(name);
      const move = el("small", { className: `prc-move ${r.movement < 0 ? "down" : "up"}`, text: r.movement > 0 ? `\u25B2${r.movement}` : r.movement < 0 ? `\u25BC${-r.movement}` : "" });
      row.appendChild(move);
      row.appendChild(el("span", { className: "prc-points" }, [el("strong", { text: String(r.score) }), el("small", { className: r.provisional ? "projected" : "", text: r.gain ? `+${r.gain}` : "" })]));
      const reading = r.frames ?? r.splitFrames;
      const showGap = state.phase === "racing" ? i > 0 && r.delta != null : r.delta != null && r.delta > 0;
      const text = r.dnf ? "DNF" : reading == null ? "\u2014" : showGap ? fmtGap(r.delta ?? 0) : fmtTime(reading);
      const time = el("span", { className: "prc-time", text });
      time.title = r.dnf ? "Retired this round" : r.frames != null ? `Finish: ${fmtTime(r.frames)}` : r.splitFrames != null ? `Checkpoint ${r.checkpoint + 1}: ${fmtTime(r.splitFrames)}` : "";
      row.appendChild(time);
      board.appendChild(row);
    }
    this.root.appendChild(board);
  }
  /** The phase line of the panel, with the countdown of a break. */
  phaseText() {
    const state = this.c?.state;
    if (!state) return "";
    const now = this.serverNow();
    const secs = (at) => Math.max(0, Math.ceil(((at ?? now) - now) / 1e3));
    switch (state.phase) {
      case "break":
        return state.nextAt ? `${state.round ? "Next round" : "Round 1"} in ${secs(state.nextAt)}s` : PHASE_NAMES.break;
      case "complete":
        return `Cup over \xB7 next cup in ${secs(state.nextAt)}s`;
      case "warmup":
        return state.live?.warmupEndsAt ? `Warmup \xB7 ${secs(state.live.warmupEndsAt)}s` : "Warmup";
      default:
        return PHASE_NAMES[state.phase] ?? state.phase;
    }
  }
  recordStrip(label, cls, holder, time) {
    return el("div", { className: `prc-record ${cls}` }, [el("strong", { text: label }), el("span", { className: "prc-holder", text: holder }), el("strong", { className: "prc-rtime", text: time })]);
  }
  renderPractice() {
    const c = this.c;
    const state = c.state;
    const live = state.live;
    const show = this.enabled && c.gameStarted && state.phase === "warmup" && !!live;
    this.practiceEl.classList.toggle("hidden", !show);
    clearChildren(this.practiceEl);
    if (!show) return;
    const racers = live.racers ?? [];
    const ready = live.warmupReady ?? [];
    const rules = state.rules ?? {};
    const box = el("div", { className: "prc-practice-box" });
    box.appendChild(el("span", { text: rules.readyEndsWarmup ? `${ready.length}/${racers.length} ready` : "Warmup" }));
    this.practiceClockEl = el("strong", { text: "" });
    box.appendChild(this.practiceClockEl);
    if (rules.readyEndsWarmup && c.isRacer()) {
      const sent = c.runtime?.warmupReadySent || ready.includes(c.you);
      const btn = el("button", { className: "button prc-ready", text: sent ? "Ready \u2713" : "Ready", on: { click: () => c.warmupReady() } });
      btn.disabled = sent;
      box.appendChild(btn);
    }
    this.practiceEl.appendChild(box);
  }
  renderSpectator() {
    const c = this.c;
    const watchable = c.mayWatch() ? c.watchable() : [];
    const show = this.enabled && c.gameStarted && watchable.length > 0 && !c.view.freecam;
    this.povEl.classList.toggle("hidden", !show);
    this.pbEl.classList.toggle("hidden", !show);
    clearChildren(this.povEl);
    clearChildren(this.pbEl);
    if (!show) return;
    const slot = watchable.includes(c.view.watchSlot) ? c.view.watchSlot : watchable[0];
    const prev = el("button", { className: "button prc-pov-cycle", attrs: { title: "Previous racer ([)" }, on: { click: () => c.cycleWatch(-1) } }, [el("span", { className: "prc-arrow left" })]);
    const next = el("button", { className: "button prc-pov-cycle", attrs: { title: "Next racer (])" }, on: { click: () => c.cycleWatch(1) } }, [el("span", { className: "prc-arrow right" })]);
    prev.disabled = next.disabled = watchable.length < 2;
    const main = el("div", { className: "prc-pov-main" }, [el("div", { className: "prc-pov-name", text: c.playerName(slot) })]);
    this.povEl.appendChild(el("div", { className: "prc-pov-box" }, [prev, main, next]));
    const keys = this.freecamKeys();
    this.povEl.appendChild(el("div", { className: "prc-pov-hint", text: `[ ] switch racer${keys ? ` \xB7 free camera: ${keys}` : ""}` }));
    const pb = c.pbOf(slot);
    this.pbEl.appendChild(el("span", { text: "PB" }));
    this.pbEl.appendChild(el("strong", { text: pb === void 0 ? "Loading\u2026" : pb === null ? "No record" : fmtTime(pb) }));
  }
  freecamKeys() {
    try {
      const c = this.c;
      if (c.rules.allowSpectatorFreecam === false || !c.native || !c.activeGame) return "";
      const settings = c.native.settings(c.activeGame);
      return (settings.getKeyBindings(c.native.KeyBinding.ToggleSpectatorCamera) ?? []).filter(Boolean).map((k) => c.native.keyLabel(k)).join(" / ");
    } catch {
      return "";
    }
  }
  // ------------------------------------------------------------- clocks (every 100 ms)
  tick() {
    const c = this.c;
    if (!this.visible || !c?.state) return;
    const state = c.state;
    const live = state.live;
    const now = this.serverNow();
    const inGame = this.enabled && c.gameStarted;
    if (this.lobbyCountdownEl) this.lobbyCountdownEl.textContent = this.lobbyCountdownText();
    const deadline = state.phase === "racing" ? live?.deadline : null;
    const secs = deadline != null ? Math.max(0, Math.ceil((deadline - now) / 1e3)) : null;
    this.timerEl.classList.toggle("visible", inGame && secs !== null);
    if (secs !== null) this.timerEl.textContent = `${secs}s`;
    let cue = "";
    if (inGame && live?.startsAt != null && (state.phase === "countdown" || state.phase === "racing") && c.inLiveSession()) {
      const remaining = live.startsAt - now;
      if (remaining <= 3e3 && remaining > -900) cue = remaining > 0 ? String(Math.ceil(remaining / 1e3)) : "GO!";
    }
    if (cue !== this.cueValue) {
      this.cueValue = cue;
      this.cueEl.classList.toggle("hidden", !cue);
      this.cueEl.classList.toggle("go", cue === "GO!");
      this.cueEl.textContent = cue;
    }
    if (this.phaseEl) {
      const phaseText = this.phaseText();
      if (this.phaseEl.textContent !== phaseText) this.phaseEl.textContent = phaseText;
    }
    let label = "";
    if (inGame) {
      if (state.phase === "warmup" && live?.warmupEndsAt) label = `Warmup \xB7 ${Math.max(0, Math.ceil((live.warmupEndsAt - now) / 1e3))}s`;
      else if (state.phase === "loading") label = state.track?.id && state.track.id !== c.track?.id ? "Changing track\u2026" : "Preparing next round\u2026";
      else if (c.view.freecam) label = "Free camera";
      else if (state.phase === "racing" && c.runtime?.retired && !c.view.following) label = "Retired";
    }
    this.downtimeEl.classList.toggle("hidden", !label);
    if (this.downtimeEl.textContent !== label) this.downtimeEl.textContent = label;
    if (this.practiceClockEl && live?.warmupEndsAt) this.practiceClockEl.textContent = `${Math.max(0, Math.ceil((live.warmupEndsAt - now) / 1e3))}s`;
    this.patchHints();
    this.avoidToolbar();
  }
  /** Keep the panel below the game's toolbar when that is showing. */
  avoidToolbar() {
    let top = 0;
    const toolbar = document.querySelector(".game-toolbar-ui > .button-container");
    if (toolbar) {
      const style = getComputedStyle(toolbar);
      const rect = toolbar.getBoundingClientRect();
      if (style.display !== "none" && Number(style.opacity) > 0.01 && rect.width > 0 && rect.left < 440 && rect.top < 200) top = Math.ceil(rect.bottom + 8);
    }
    if (top !== this.toolbarTop) {
      this.toolbarTop = top;
      this.root.style.top = `${top}px`;
    }
  }
  /** The game's "Press T / Backspace to start over." hint: in a live round the key retires. */
  patchHints() {
    const c = this.c;
    const retiring = c.runtime?.racer && c.state?.phase === "racing" && !c.roundDone() && c.raceStarted();
    const root = c.gameInfo?.hud?.element;
    for (const [node, text] of this.hintNodes) {
      if (!retiring || !root?.contains(node)) {
        if (node.textContent === RETIRE_HINT) node.textContent = text;
        this.hintNodes.delete(node);
      }
    }
    if (!retiring || !root) return;
    for (const line of root.querySelectorAll(".hint-ui .title, .hint-ui .subtitle")) {
      for (const node of line.childNodes) {
        if (node.nodeType === 3 && node.textContent === ORIGINAL_HINT) {
          this.hintNodes.set(node, ORIGINAL_HINT);
          node.textContent = RETIRE_HINT;
        }
      }
    }
  }
  restoreHints() {
    for (const [node, text] of this.hintNodes) if (node.textContent === RETIRE_HINT) node.textContent = text;
    this.hintNodes.clear();
  }
};

// mod/src/main.js
var PolyRankedMod = class extends PolyMod {
  constructor() {
    super();
    this.pml = null;
    this.bridgeInstalled = false;
    this.app = null;
    this.preInit = (pml) => {
      this.pml = pml;
      this.bridgeInstalled = installBridgeMixin(pml);
      log.info("pre-init: bridge mixin " + (this.bridgeInstalled ? "registered" : "FAILED"));
    };
    this.init = (pml) => {
      this.pml = pml;
    };
    this.postInit = () => {
      if (!this.bridgeInstalled) {
        log.error("game bridge mixin not installed; PolyRanked is disabled");
        return;
      }
      waitForBridge().then((bridge) => this.boot(bridge)).catch((err) => log.error("bridge never became ready", err));
    };
    this.onGameLoad = () => {
      this.app?.onGameLoad();
    };
  }
  boot(bridge) {
    const problems = validateBridge(bridge);
    if (problems.length) {
      log.error("unexpected game internals (" + problems.join(", ") + "); PolyRanked is disabled");
      return;
    }
    this.app = new PolyRankedApp({ pml: this.pml, bridge });
    this.app.start();
    globalThis.polyRanked = this.app;
  }
};
var PolyRankedApp = class {
  constructor({ pml, bridge }) {
    this.pml = pml;
    this.bridge = bridge;
    this.game = lookupGame(pml);
    this.settings = loadSettings();
    this.client = new RankedClient({
      url: () => this.settings.serverUrl,
      secret: () => getSecret(),
      profile: () => this.profile(),
      vanilla: () => this.isVanilla(),
      gameVersion: GAME_VERSION,
      modVersion: MOD_VERSION
    });
    this.menu = null;
    this.hud = null;
    this.controller = null;
    this.native = null;
    this.cupHud = null;
    this.cup = null;
    this.removeMenuButton = null;
    this.pendingQueue = null;
    this.pendingCupJoin = false;
    this.cupNotice = null;
    this.cupButton = null;
  }
  start() {
    injectStyles();
    this.menu = new RankedMenu({ settings: this.settings });
    this.hud = new MatchHud({ serverNow: () => this.client.serverNow() });
    this.hud.setEnabled(this.settings.showHud !== false);
    this.controller = new MatchController({ client: this.client, bridge: this.bridge, game: this.game, hud: this.hud });
    this.native = connectGame(this.pml);
    if (!this.native) log.warn("live-round hooks unavailable on this game build; the cup cannot be joined");
    this.cupHud = new CupHud({ serverNow: () => this.client.serverNow() });
    this.cupHud.setEnabled(this.settings.showHud !== false);
    this.cup = new CupController({ client: this.client, bridge: this.bridge, game: this.game, native: this.native, hud: this.cupHud });
    if (SHOW_MENU_BUTTON) this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
    this.cupButton = installCupButton({
      onJoin: () => this.joinCup(),
      onLeave: () => this.cup.leaveCup(),
      fetchState: () => this.fetchCupState(),
      localState: () => ({ inCup: this.cup.active, phase: this.cup.phase, racing: this.cup.isRacer(), notice: this.cupNotice }),
      serverNow: () => this.client.serverNow()
    });
    this.onKeyDown = (ev) => {
      if (ev.code === "F7" && !ev.repeat) {
        ev.preventDefault();
        this.toggleMenu();
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
    this.wire();
    if (this.settings.autoConnect !== false) this.client.connect();
    this.scheduleGaragePrompt();
    log.info(`${MOD_NAME} ${MOD_VERSION} ready (server: ${this.settings.serverUrl})`);
  }
  /**
   * New profiles race as "Anonymous" with a random car. Once the main menu is idle, ask once
   * whether to visit the Garage to pick a nickname and car before playing ranked.
   */
  scheduleGaragePrompt() {
    const KEY = "polyranked.garagePrompted";
    let storage2 = null;
    try {
      storage2 = globalThis.localStorage;
    } catch {
    }
    if (storage2?.getItem(KEY) || this.settings.nameOverride || typeof this.bridge.openGarage !== "function") return;
    const needsName = () => {
      try {
        const p = this.bridge.profiles.getCurrentUserProfile();
        return !p.nickname || p.nickname === "Anonymous";
      } catch {
        return false;
      }
    };
    if (!needsName()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 600) return clearInterval(timer);
      if (this.controller.active || this.cup.active || this.menu.isOpen) return;
      let ready = false;
      try {
        const state = this.bridge.getState();
        const classes = this.bridge.getStateClasses();
        ready = state instanceof classes.MainMenu && !this.bridge.popups.isOpen && !document.querySelector(".news-popup-ui") && !document.querySelector(".loading-screen");
      } catch {
        ready = false;
      }
      if (!ready) return;
      clearInterval(timer);
      if (!needsName()) return;
      storage2?.setItem(KEY, "1");
      try {
        this.bridge.popups.showConfirm(
          'Welcome to ranked PolyTrack!\n\nYou are playing as "Anonymous" with a random car. Visit the Garage to pick your nickname and car first \u2013 other players will see them in matches.',
          "Later",
          "Go to Garage",
          null,
          () => {
            try {
              this.bridge.openGarage();
            } catch (err) {
              log.error("could not open the garage", err);
            }
          }
        );
      } catch (err) {
        log.warn("garage prompt failed", err);
      }
    }, 500);
  }
  onGameLoad() {
    if (!SHOW_MENU_BUTTON) return;
    this.removeMenuButton?.();
    this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
  }
  profile() {
    let nickname = "Anonymous";
    let countryCode = null;
    let carStyle = null;
    try {
      const p = this.bridge.profiles.getCurrentUserProfile();
      nickname = p.nickname ?? nickname;
      countryCode = p.countryCode ?? null;
      carStyle = typeof p.carStyle?.serialize === "function" ? p.carStyle.serialize() : null;
    } catch (err) {
      log.warn("could not read the user profile", err);
    }
    if (this.settings.nameOverride) nickname = this.settings.nameOverride;
    return { nickname, countryCode, carStyle };
  }
  isVanilla() {
    let vanilla = true;
    try {
      vanilla = this.pml.isVanillaCompatible() !== false;
    } catch {
    }
    return vanilla && physicsDeterministic(this.bridge, this.game);
  }
  /** Names of the loaded mods that report a physics change (with their reason when they give one). */
  physicsMods() {
    try {
      return this.pml.getAllMods().filter((m) => m.isLoaded && m.touchingPhysics === true).map((m) => m.physicsReason ? `${m.modName} (${m.physicsReason})` : m.modName);
    } catch {
      return [];
    }
  }
  toggleMenu() {
    if (this.controller.active && !this.menu.isOpen) return;
    if (this.cup.active && this.cup.gameStarted && !this.menu.isOpen) return;
    this.menu.toggle();
  }
  // ------------------------------------------------------------- cup
  httpBase() {
    return String(this.settings.serverUrl ?? "").trim().replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
  }
  async fetchCupState() {
    const base = this.httpBase();
    if (!/^https?:/.test(base)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4e3);
    try {
      const res = await fetch(`${base}/api/cup`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  /** "Join the Cup" on the multiplayer page: connect if needed, then ask the server for a seat. */
  joinCup() {
    this.cupNotice = null;
    if (this.cup.active) {
      this.cupButton?.refresh();
      return;
    }
    if (this.controller.active) {
      this.cupNotice = "Finish your ranked match first";
      this.cupButton?.refresh();
      return;
    }
    if (!this.native) {
      this.cupNotice = "The cup needs PolyTrack 0.6.3 internals this game build does not have";
      this.cupButton?.refresh();
      return;
    }
    const determinism = physicsDeterminism(this.bridge, this.game);
    if (determinism === "pending") {
      this.cupNotice = "The game is still running its physics self-test \u2013 try again in a few seconds";
      this.cupButton?.refresh();
      return;
    }
    if (!this.isVanilla()) {
      const culprits = this.physicsMods();
      this.cupNotice = culprits.length ? `The cup needs vanilla physics. Mods changing it: ${culprits.join(", ")}` : "The cup needs vanilla physics (the game's physics self-test failed)";
      this.cupButton?.refresh();
      return;
    }
    if (this.client.ready) this.sendCupJoin();
    else {
      this.pendingCupJoin = true;
      this.cupNotice = "Connecting to the server\u2026";
      this.client.connect();
    }
    this.cupButton?.refresh();
  }
  sendCupJoin() {
    this.pendingCupJoin = false;
    this.client.send({ type: MSG.CUP_JOIN, vanilla: true });
  }
  wire() {
    const { client, menu, controller } = this;
    client.on("state", ({ state, detail }) => {
      menu.setConnectionState(state, detail);
      if (state === "ready") {
        menu.setWelcome(client.welcome);
        if (this.pendingQueue) {
          client.send({ type: MSG.QUEUE_JOIN, queue: this.pendingQueue });
          this.pendingQueue = null;
        }
        if (this.pendingCupJoin) {
          this.cupNotice = null;
          this.sendCupJoin();
        }
        if (client.welcome?.cup) this.cupButton?.setState(client.welcome.cup);
      } else if (state === "disconnected" && this.pendingCupJoin && detail) {
        this.pendingCupJoin = false;
        this.cupNotice = `Could not reach the server \u2013 ${detail}`;
      }
      this.cupButton?.refresh();
    });
    client.on(MSG.QUEUE_STATUS, (msg) => menu.setQueueStatus(msg));
    client.on(MSG.LEADERBOARD, (msg) => menu.setLeaderboard(msg));
    client.on(MSG.PROFILE, (msg) => menu.setProfile(msg.profile));
    client.on("error", (msg) => {
      menu.setNotice(msg.message, "error");
      if (msg.code === "cannot_queue" || msg.code === "in_match") menu.setQueueStatus(null);
      if (["cup_full", "cup_disabled", "cannot_queue", "in_match"].includes(msg.code) && !controller.active && !this.cup.active) {
        this.cupNotice = msg.message;
        this.cupButton?.refresh();
      }
    });
    client.on(MSG.MATCH_FOUND, (msg) => {
      menu.setQueueStatus(null);
      this.cupNotice = null;
      menu.setNotice(msg.format?.cup ? `Joined the ${msg.queueName ?? "cup"} \u2013 loading ${msg.track?.name ?? "the track"}\u2026` : `Match found on ${msg.track?.name ?? "a track"} \u2013 loading\u2026`);
      menu.close();
      this.cupButton?.refresh();
    });
    client.on(MSG.CUP_STATE, (msg) => this.cupButton?.setState(msg.cup));
    client.on(MSG.MATCH_END, (msg) => {
      const r = msg.ratings?.[controller.match?.you];
      if (r) {
        menu.setNotice(`Last match: ${r.result} (${r.delta >= 0 ? "+" : ""}${r.delta}) \u2013 ${r.division}`);
        if (client.welcome?.profile?.ratings?.[controller.match.queueId]) {
          const entry = client.welcome.profile.ratings[controller.match.queueId];
          entry.rating = r.after;
          entry.label = r.division;
          entry.matches = (entry.matches ?? 0) + 1;
          if (r.result === "win") entry.wins = (entry.wins ?? 0) + 1;
          else if (r.result === "loss") entry.losses = (entry.losses ?? 0) + 1;
          menu.setProfile(client.welcome.profile);
        }
      }
    });
    menu.on("connect", () => client.connect());
    menu.on("disconnect", () => client.disconnect());
    menu.on("queue", (queueId) => {
      menu.setNotice(null);
      if (this.cup.active) {
        menu.setNotice("Leave the cup before queueing for ranked.", "error");
        return;
      }
      const determinism = physicsDeterminism(this.bridge, this.game);
      if (determinism === "pending") {
        menu.setNotice("The game is still running its physics self-test \u2013 try again in a few seconds.", "error");
        return;
      }
      if (!this.isVanilla()) {
        const culprits = this.physicsMods();
        menu.setNotice(
          culprits.length ? `Ranked requires vanilla physics. Mods changing it: ${culprits.join(", ")}.` : "Ranked requires vanilla physics: disable physics mods and make sure the game's physics self-test passed.",
          "error"
        );
        return;
      }
      client.send({ type: MSG.QUEUE_JOIN, queue: queueId, vanilla: true });
    });
    menu.on("cancelQueue", () => client.send({ type: MSG.QUEUE_LEAVE }));
    menu.on("leaderboard", (queueId) => client.send({ type: MSG.LEADERBOARD_GET, queue: queueId }));
    menu.on("settings", (patch) => {
      const urlChanged = patch.serverUrl !== this.settings.serverUrl;
      this.settings = saveSettings({ ...this.settings, ...patch });
      menu.setSettings(this.settings);
      this.hud.setEnabled(this.settings.showHud !== false);
      this.cupHud.setEnabled(this.settings.showHud !== false);
      if (urlChanged) {
        client.disconnect();
        client.connect();
      }
    });
    controller.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    controller.on("left", () => {
      menu.setNotice("You left the match (counts as a loss).");
      this.cupButton?.refresh();
    });
    this.cup.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    this.cup.on("left", () => {
      menu.setNotice("You left the cup.");
      this.cupButton?.refresh();
    });
    this.cup.on("state", (state) => {
      if (state) this.cupButton?.setState(state);
      else this.cupButton?.refresh();
    });
    controller.on("queueAgain", () => {
      const queueId = controller.matchEnd?.queueId ?? client.welcome?.queues?.[0]?.id;
      menu.open();
      if (queueId && client.ready) client.send({ type: MSG.QUEUE_JOIN, queue: queueId });
      else this.pendingQueue = queueId ?? null;
    });
  }
};
var polyMod = Object.assign(new PolyRankedMod(), {
  modName: MOD_NAME,
  modID: MOD_ID,
  modVersion: MOD_VERSION,
  modAuthor: "boosterfrank",
  touchingPhysics: false
});
export {
  polyMod
};
