import { MSG, PROTOCOL_VERSION } from "../../shared/protocol.js";
import { Emitter, log } from "./util.js";

const PING_INTERVAL_MS = 5000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/**
 * WebSocket client for the PolyRanked server.
 *
 * Events (via `on(type, handler)`):
 *  - "state"   -> "disconnected" | "connecting" | "connected" | "ready"
 *  - "<msg.type>" for every JSON message (detail = message)
 *  - "message" for every JSON message
 *  - "binary"  for binary frames (detail = Uint8Array)
 *  - "error"   for protocol errors sent by the server
 */
export class RankedClient extends Emitter {
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
    this.clockOffset = 0; // serverTime - localTime
    this.autoReconnect = false;
    this._reconnectDelay = RECONNECT_MIN_MS;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._pendingPings = new Map();
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
        ws.close(1000, "bye");
      } catch {
        /* ignore */
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
      vanilla: this.opts.vanilla(),
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
}
