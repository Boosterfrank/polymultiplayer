// PolyRanked 0.1.0 – https://github.com/boosterfrank/polymultiplayer (built 2026-10-20)

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
  PROFILE: "profile"
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
var DEFAULT_SERVER_URL = true ? "ws://localhost:8788" : "ws://localhost:8788";
var MOD_VERSION = true ? "0.1.0" : "0.0.0-dev";
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
    const frames = time?.numberOfFrames;
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
  /** A new round: tell the game to (re)start on the track. */
  startSession(sessionId, track) {
    this.sessionId = sessionId;
    this.sessionEnded = false;
    this.track = track;
    for (const p of this.players.values()) p.record = null;
    this.pending = { sessionId, resetCounter: 0, states: [] };
    for (const cb of [...this.cb.newSession]) safe(() => cb(sessionId, this.gameMode, track.trackMetadata, track.trackData), "newSession");
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
  return { trackMetadata: result.trackMetadata, trackData: result.trackData };
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
    this.connection = this.createConnection(msg);
    this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
  }
  async onMatchResume(msg) {
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
        this.track = await resolveTrack(this.bridge, this.game, msg.track);
        this.match.track = msg.track;
      } catch (err) {
        log.error("failed to load the round track", err);
      }
    }
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
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
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
  render() {
    if (!this.match) return;
    clearChildren(this.root);
    const f = this.match.format;
    const roundsInfo = f.roundsToWin ? `first to ${f.roundsToWin}` : `of ${f.maxRounds}`;
    this.root.appendChild(
      el("div", { className: "pr-card" }, [
        el("div", { className: "pr-title" }, [el("span", { text: this.match.queueName }), el("span", { text: this.round ? `Round ${this.round} \xB7 ${roundsInfo}` : "Loading\u2026" })]),
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
    this.removeMenuButton = null;
    this.pendingQueue = null;
  }
  start() {
    injectStyles();
    this.menu = new RankedMenu({ settings: this.settings });
    this.hud = new MatchHud({ serverNow: () => this.client.serverNow() });
    this.hud.setEnabled(this.settings.showHud !== false);
    this.controller = new MatchController({ client: this.client, bridge: this.bridge, game: this.game, hud: this.hud });
    this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
    this.onKeyDown = (ev) => {
      if (ev.code === "F7" && !ev.repeat) {
        ev.preventDefault();
        this.toggleMenu();
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
    this.wire();
    if (this.settings.autoConnect !== false) this.client.connect();
    log.info(`${MOD_NAME} ${MOD_VERSION} ready (server: ${this.settings.serverUrl})`);
  }
  onGameLoad() {
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
  toggleMenu() {
    if (this.controller.active && !this.menu.isOpen) {
      return;
    }
    this.menu.toggle();
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
      }
    });
    client.on(MSG.QUEUE_STATUS, (msg) => menu.setQueueStatus(msg));
    client.on(MSG.LEADERBOARD, (msg) => menu.setLeaderboard(msg));
    client.on(MSG.PROFILE, (msg) => menu.setProfile(msg.profile));
    client.on("error", (msg) => {
      menu.setNotice(msg.message, "error");
      if (msg.code === "cannot_queue" || msg.code === "in_match") menu.setQueueStatus(null);
    });
    client.on(MSG.MATCH_FOUND, (msg) => {
      menu.setQueueStatus(null);
      menu.setNotice(`Match found on ${msg.track?.name ?? "a track"} \u2013 loading\u2026`);
      menu.close();
    });
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
      const determinism = physicsDeterminism(this.bridge, this.game);
      if (determinism === "pending") {
        menu.setNotice("The game is still running its physics self-test \u2013 try again in a few seconds.", "error");
        return;
      }
      if (!this.isVanilla()) {
        menu.setNotice("Ranked requires vanilla physics: disable physics mods and make sure the game's physics self-test passed.", "error");
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
      if (urlChanged) {
        client.disconnect();
        client.connect();
      }
    });
    controller.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    controller.on("left", () => menu.setNotice("You left the match (counts as a loss)."));
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
