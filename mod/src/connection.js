import { MSG, encodeCarBatch, decodeCarRelay } from "../../shared/protocol.js";
import { encodeCarState, decodeCarState, normalizeQuaternion } from "./carstate.js";
import { CAR_FLUSH_MS, GAME_MODE_COMPETITIVE } from "./config.js";
import { log, safe } from "./util.js";

/**
 * Minimal stand-in for the game's race-time class. The game only reads
 * `numberOfFrames`, `time`, and calls clone/lessThan/greaterThan/equals/isNegative on records.
 */
export class FrameTime {
  constructor(frames = 0) {
    this._frames = frames;
  }
  get numberOfFrames() {
    return this._frames;
  }
  get time() {
    return this._frames / 1000;
  }
  clone() {
    return new FrameTime(this._frames);
  }
  difference(other) {
    return new FrameTime(this._frames - other.numberOfFrames);
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
}

/**
 * Implements the duck-typed `multiplayerConnection` interface that PolyTrack's in-game
 * state consumes, backed by the PolyRanked WebSocket client.
 */
export class RankedConnection {
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
    this.onDispose = opts.onDispose ?? (() => {});
    this.onAttached = opts.onAttached ?? (() => {});
    this.gameMode = opts.gameMode ?? GAME_MODE_COMPETITIVE;
    this.flushIntervalMs = opts.flushIntervalMs ?? CAR_FLUSH_MS;

    this.players = new Map();
    for (const p of opts.players ?? []) this.upsertPlayer(p);
    this.pings = new Map();

    this.sessionId = null;
    this.sessionEnded = false;
    this.track = null; // {trackMetadata, trackData}
    this.disposed = false;
    this.lost = null;

    this.cb = {
      connectionLost: [],
      playersChanged: [],
      carReset: [],
      carUpdate: [],
      endSession: [],
      newSession: [],
      serverMessage: [],
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
      isSelf: p.slot === this.matchSlot,
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
        isSelf: p.isSelf,
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
}
